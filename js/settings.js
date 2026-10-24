/**
 * settings.js — renders and binds the settings sheet.
 * Controls write straight into the store; main.js reacts to the changes
 * (theme, volume, wake lock, durations…). `sync()` reflects outside changes
 * (imports, other tabs) back into the controls.
 */

import { LIMITS, DEFAULT_SETTINGS, SCHEMA_VERSION, sanitize, defaultState } from "./state.js";
import { $, $$, esc, icon, segmented, toast } from "./ui.js";
import { notificationStatus, requestNotificationPermission, wakeLockSupported, platform } from "./notify.js";
import { isPersistent } from "./storage.js";

const get = (obj, path) => path.split(".").reduce((o, k) => o?.[k], obj);
const set = (obj, path, value) => {
  const keys = path.split(".");
  const last = keys.pop();
  keys.reduce((o, k) => o[k], obj)[last] = value;
};

const stepper = (path, label, desc, [min, max], unit) => `
  <div class="row">
    <div class="row__text"><span class="row__label" id="lbl-${path}">${label}</span>${desc ? `<span class="row__desc">${desc}</span>` : ""}</div>
    <div class="stepper" data-path="${path}" data-min="${min}" data-max="${max}">
      <button class="stepper__btn" type="button" data-step="-1" aria-label="Decrease ${label}">${icon("minus")}</button>
      <input class="stepper__value" type="number" inputmode="numeric" min="${min}" max="${max}" aria-labelledby="lbl-${path}" />
      <span class="stepper__unit" aria-hidden="true">${unit}</span>
      <button class="stepper__btn" type="button" data-step="1" aria-label="Increase ${label}">${icon("plus")}</button>
    </div>
  </div>`;

const toggle = (path, label, desc, extra = "") => `
  <div class="row" data-row="${path}">
    <div class="row__text">
      <span class="row__label" id="lbl-${path}">${label}</span>
      ${desc ? `<span class="row__desc" id="desc-${path}">${desc}</span>` : ""}
      ${extra}
    </div>
    <button class="switch" type="button" role="switch" data-path="${path}" aria-checked="false" aria-labelledby="lbl-${path}" ${desc ? `aria-describedby="desc-${path}"` : ""}>
      <span class="switch__knob"></span>
    </button>
  </div>`;

const group = (title, body) => `
  <section class="group">
    <h3 class="eyebrow group__title">${title}</h3>
    <div class="group__card">${body}</div>
  </section>`;

export function initSettings(container, { store, onPreviewSound, onToast }) {
  container.innerHTML = [
    group(
      "Timer",
      stepper("durations.focus", "Focus", "", LIMITS.focus, "min") +
        stepper("durations.short", "Short break", "", LIMITS.short, "min") +
        stepper("durations.long", "Long break", "", LIMITS.long, "min") +
        stepper("longInterval", "Long break every", "Focus sessions per cycle", LIMITS.longInterval, "×"),
    ),
    group(
      "Flow",
      toggle("autoStartBreaks", "Auto-start breaks", "Begin the break as soon as focus ends") +
        toggle("autoStartFocus", "Auto-start focus", "Begin the next session after a break"),
    ),
    group("Daily goal", stepper("dailyGoal", "Sessions per day", "A small celebration when you get there", LIMITS.dailyGoal, "")),
    group(
      "Sound",
      toggle("sound", "Chimes", "Soft tones when a phase ends") +
        `<div class="row row--stack" data-row="volume">
          <div class="row__head"><span class="row__label" id="lbl-volume">Volume</span>
            <button class="btn btn--ghost" type="button" id="btn-preview">${icon("play-sm")}Preview</button></div>
          <div class="range-row">${icon("volume")}
            <input class="range" type="range" min="0" max="100" step="1" id="volume" aria-labelledby="lbl-volume" />
            <span class="range-value" id="volume-value">70</span></div>
        </div>` +
        toggle("tick", "Ticking", "A barely-there tick each second"),
    ),
    group(
      "Alerts",
      toggle("notifications", "Notifications", "Alert when a phase ends while you're away", `<span class="row__note" id="notif-note" hidden></span>`) +
        toggle("vibration", "Vibration", "Haptic tap when a phase ends", `<span class="row__note" id="vibe-note" hidden></span>`) +
        toggle("wakeLock", "Keep screen awake", "During focus sessions", `<span class="row__note" id="wake-note" hidden></span>`),
    ),
    group(
      "Appearance",
      `<div class="row row--stack"><span class="row__label" id="lbl-theme">Theme</span>
        <div class="segmented segmented--sm" role="radiogroup" aria-labelledby="lbl-theme" id="theme-switch">
          <span class="segmented__pill" aria-hidden="true"></span>
          <button class="segmented__opt" type="button" role="radio" data-value="light">Light</button>
          <button class="segmented__opt" type="button" role="radio" data-value="dark">Dark</button>
          <button class="segmented__opt" type="button" role="radio" data-value="auto">Auto</button>
        </div></div>`,
    ),
    group(
      "Data",
      `<div class="row row--stack">
        <div class="row__text"><span class="row__label">Backup</span><span class="row__desc">Export your settings and history as JSON, or restore a backup.</span></div>
        <div class="btn-row">
          <button class="btn" type="button" id="btn-export">${icon("download")}Export</button>
          <button class="btn" type="button" id="btn-import">${icon("upload")}Import</button>
          <input type="file" id="import-file" accept="application/json,.json" hidden />
        </div>
      </div>
      <div class="row row--stack">
        <div class="row__text"><span class="row__label">Reset</span><span class="row__desc">Erase all sessions and restore default settings.</span></div>
        <div class="btn-row"><button class="btn btn--danger" type="button" id="btn-reset-data">${icon("trash")}<span>Reset all data</span></button></div>
      </div>`,
    ),
    `<p class="about">Pomodoro Timer · works offline${isPersistent() ? "" : " · storage is blocked, data lasts this visit only"}</p>`,
  ].join("");

  const update = (path, value) => store.update((s) => set(s.settings, path, value), { action: "settings", path });

  /* Steppers: tap, hold-to-repeat, or type */
  $$(".stepper", container).forEach((el) => {
    const path = el.dataset.path;
    const min = Number(el.dataset.min);
    const max = Number(el.dataset.max);
    const input = $("input", el);
    const commit = (v) => {
      const next = Math.min(max, Math.max(min, Math.round(v)));
      if (Number.isNaN(next)) return;
      if (next !== get(store.get().settings, path)) {
        update(path, next);
        input.classList.remove("is-bump");
        void input.offsetWidth; // restart the bump animation
        input.classList.add("is-bump");
      }
      input.value = String(next);
    };
    $$(".stepper__btn", el).forEach((btn) => {
      const step = Number(btn.dataset.step);
      let hold = 0;
      let repeat = 0;
      let repeated = false;
      const stop = () => {
        clearTimeout(hold);
        clearInterval(repeat);
      };
      // Hold to repeat; a plain tap is handled by click (so scrolling never edits).
      btn.addEventListener("pointerdown", (e) => {
        if (e.button > 0) return;
        repeated = false;
        hold = setTimeout(() => {
          repeated = true;
          const tickStep = () => (btn.disabled ? stop() : commit(get(store.get().settings, path) + step));
          tickStep();
          repeat = setInterval(tickStep, 85);
        }, 420);
      });
      ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => btn.addEventListener(ev, stop));
      btn.addEventListener("click", () => {
        if (repeated) {
          repeated = false;
          return;
        }
        commit(get(store.get().settings, path) + step);
      });
    });
    input.addEventListener("change", () => commit(Number(input.value)));
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });
  });

  /* Switches */
  $$(".switch", container).forEach((sw) => {
    const path = sw.dataset.path;
    sw.addEventListener("click", async () => {
      const next = sw.getAttribute("aria-checked") !== "true";
      if (path === "notifications" && next) {
        const status = notificationStatus();
        if (status === "unsupported" || status === "ios-install") {
          syncNotes();
          return;
        }
        const result = await requestNotificationPermission();
        if (result !== "granted") {
          onToast(result === "denied" ? "Notifications are blocked in your browser settings" : "Notifications weren't enabled", "bell");
          syncNotes();
          return;
        }
      }
      update(path, next);
    });
  });

  /* Volume */
  const vol = $("#volume", container);
  const volValue = $("#volume-value", container);
  vol.addEventListener("input", () => {
    const v = Number(vol.value);
    vol.style.setProperty("--fill", `${v}%`);
    volValue.textContent = String(v);
    update("volume", v / 100);
  });
  vol.addEventListener("change", () => onPreviewSound());
  $("#btn-preview", container).addEventListener("click", () => onPreviewSound());

  /* Theme */
  const theme = segmented($("#theme-switch", container), (value) => update("theme", value));

  /* Export / import */
  $("#btn-export", container).addEventListener("click", () => {
    const data = { app: "pomodoro-timer", exportedAt: new Date().toISOString(), ...store.get(), version: SCHEMA_VERSION };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pomodoro-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
    onToast("Backup exported", "download");
  });
  const file = $("#import-file", container);
  $("#btn-import", container).addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files?.[0];
    file.value = "";
    if (!f) return;
    try {
      if (f.size > 5_000_000) throw new Error("too large");
      const parsed = JSON.parse(await f.text());
      if (!parsed || typeof parsed !== "object" || (!parsed.settings && !parsed.sessions && !parsed.days)) throw new Error("shape");
      const clean = sanitize(parsed);
      // Keep the live timer as is; adopt settings + history from the file.
      const current = store.get();
      clean.timer = current.timer;
      store.replace(clean, { action: "import" });
      onToast(`Backup restored · ${clean.sessions.length} sessions`, "check");
    } catch {
      onToast("That file isn't a valid Pomodoro backup", "info");
    }
  });

  /* Reset: tap once to arm, again to confirm */
  const resetBtn = $("#btn-reset-data", container);
  let armed = 0;
  resetBtn.addEventListener("click", () => {
    if (!armed) {
      resetBtn.classList.add("is-armed");
      $("span", resetBtn).textContent = "Tap again to erase everything";
      armed = setTimeout(disarm, 3500);
      return;
    }
    disarm();
    store.replace(defaultState(), { action: "reset-data" });
    onToast("All data cleared", "trash");
  });
  function disarm() {
    clearTimeout(armed);
    armed = 0;
    resetBtn.classList.remove("is-armed");
    $("span", resetBtn).textContent = "Reset all data";
  }

  /* Capability notes */
  function syncNotes() {
    const s = store.get().settings;
    const n = $("#notif-note", container);
    const status = notificationStatus();
    let note = "";
    if (status === "ios-install") note = "On iPhone and iPad, add Pomodoro to your Home Screen (Share → Add to Home Screen) to enable notifications.";
    else if (status === "unsupported") note = "Notifications aren't supported in this browser.";
    else if (status === "denied") note = "Notifications are blocked. Allow them in your browser's site settings.";
    n.hidden = !note;
    n.innerHTML = note ? `${icon("info")}<span>${esc(note)}</span>` : "";
    const notifSwitch = $('[data-path="notifications"]', container);
    notifSwitch.disabled = status === "unsupported" || status === "ios-install";
    notifSwitch.setAttribute("aria-checked", String(s.notifications && status === "granted"));

    const vibeOk = "vibrate" in navigator && !platform.iOS;
    const v = $("#vibe-note", container);
    v.hidden = vibeOk;
    v.innerHTML = vibeOk ? "" : `${icon("info")}<span>Not supported on this device.</span>`;
    $('[data-path="vibration"]', container).disabled = !vibeOk;
    $('[data-row="vibration"]', container).classList.toggle("is-disabled", !vibeOk);

    const wakeOk = wakeLockSupported();
    const w = $("#wake-note", container);
    w.hidden = wakeOk;
    w.innerHTML = wakeOk ? "" : `${icon("info")}<span>Not supported in this browser.</span>`;
    $('[data-path="wakeLock"]', container).disabled = !wakeOk;
    $('[data-row="wakeLock"]', container).classList.toggle("is-disabled", !wakeOk);
  }

  /** Reflect store values into the controls. */
  function sync() {
    const s = store.get().settings;
    $$(".stepper", container).forEach((el) => {
      const input = $("input", el);
      const value = get(s, el.dataset.path);
      if (document.activeElement !== input) input.value = String(value);
      const [dec, inc] = $$(".stepper__btn", el);
      dec.disabled = value <= Number(el.dataset.min);
      inc.disabled = value >= Number(el.dataset.max);
    });
    $$(".switch", container).forEach((sw) => {
      if (sw.dataset.path === "notifications") return;
      sw.setAttribute("aria-checked", String(Boolean(get(s, sw.dataset.path))));
    });
    const v = Math.round(s.volume * 100);
    if (document.activeElement !== vol) vol.value = String(v);
    vol.style.setProperty("--fill", `${v}%`);
    volValue.textContent = String(v);
    vol.disabled = !s.sound;
    $('[data-row="volume"]', container).classList.toggle("is-disabled", !s.sound);
    $('[data-path="tick"]', container).disabled = !s.sound;
    $('[data-row="tick"]', container).classList.toggle("is-disabled", !s.sound);
    theme.set(s.theme);
    syncNotes();
  }

  sync();
  return { sync };
}

export { DEFAULT_SETTINGS };
