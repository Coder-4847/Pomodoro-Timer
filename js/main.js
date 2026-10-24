/**
 * main.js — wires the store, timer engine and interface together:
 * the frame loop, rendering, phase-end choreography, keyboard shortcuts,
 * focus (zen) mode, views, theming, wake lock and the service worker.
 */

import { createStore, MODE_LABELS, MODES, dayKey } from "./state.js";
import { Timer } from "./timer.js";
import * as audio from "./audio.js";
import { showNotification, vibrate, setWakeLock } from "./notify.js";
import { renderToday, renderStats } from "./stats.js";
import { initSettings } from "./settings.js";
import { TabIndicator } from "./tab.js";
import { celebrateSession, celebrateGoal, wave } from "./fx.js";
import {
  $,
  $$,
  Odometer,
  Ring,
  PlayMorph,
  segmented,
  toast,
  announce,
  Layer,
  topLayer,
  ripple,
  magnetic,
  animate,
  EASE,
  reducedMotion,
} from "./ui.js";

const root = document.documentElement;
const store = createStore();
const timer = new Timer(store);
const tab = new TabIndicator();

/* ---- Element references --------------------------------------------- */
const el = {
  ringWrap: $("#ring-wrap"),
  ringSvg: $(".ring"),
  ringCenter: $("#ring-center"),
  halo: $(".ring__halo"),
  modeLabel: $("#mode-label"),
  dots: $("#dots"),
  timeSr: $("#time-sr"),
  awayNote: $("#away-note"),
  awayText: $("#away-text"),
  task: $("#task-input"),
  play: $("#btn-play"),
  reset: $("#btn-reset"),
  skip: $("#btn-skip"),
  zenBtn: $("#btn-zen"),
  zenExit: $("#btn-zen-exit"),
  zenHint: $("#zen-hint"),
  statsBtn: $("#btn-stats"),
  settingsBtn: $("#btn-settings"),
  timerView: $("#main"),
  statsView: $("#view-stats"),
  statsBody: $("#stats-body"),
  todayCount: $("#today-count"),
};

const digits = new Odometer($("#digits"));
const counter = new Odometer(el.todayCount);
const ring = new Ring($("#ring-progress"), $("#ring-tip"));
const morph = new PlayMorph($("#play-a"), $("#play-b"));
const modeSwitch = segmented($("#mode-switch"), (mode) => userSetMode(mode));
const todayRefs = {
  counter,
  countSr: $("#today-count-sr"),
  goal: $("#goal"),
  goalFill: $("#goal-fill"),
  goalText: $("#goal-text"),
  time: $("#today-time"),
  streak: $("#today-streak"),
  flame: $(".today .flame"),
  date: $("#today-date"),
  recent: $("#today-recent"),
};

/* ---- Helpers ---------------------------------------------------------- */
const pad = (n) => String(n).padStart(2, "0");
const secondsLeft = (ms) => Math.ceil(ms / 1000);
const formatClock = (ms) => {
  const s = secondsLeft(ms);
  return `${pad(Math.floor(s / 60))}:${pad(s % 60)}`;
};
const spokenTime = (ms) => {
  const s = secondsLeft(ms);
  const m = Math.floor(s / 60);
  const sec = s % 60;
  const parts = [];
  if (m) parts.push(`${m} minute${m === 1 ? "" : "s"}`);
  if (sec || !m) parts.push(`${sec} second${sec === 1 ? "" : "s"}`);
  return parts.join(" ");
};

const THEME_COLORS = {
  light: { focus: "#f2f6fb", short: "#fbf7ec", long: "#fdf4ee" },
  dark: { focus: "#0e1521", short: "#16130c", long: "#19110d" },
};

/* ======================================================================
   Rendering
   ====================================================================== */
let loaded = false;
let lastDotsKey = "";
let lastCycle = store.get().timer.cycle;
let modeHoldUntil = 0;
let modeHoldTimer = 0;
// During the completion beat the ring stays full and the digits read 00:00.
let completionHold = null;

function applyModeAttr(mode) {
  const wait = modeHoldUntil - performance.now();
  clearTimeout(modeHoldTimer);
  if (wait > 0) {
    modeHoldTimer = setTimeout(() => applyModeAttr(store.get().timer.mode), wait);
    return;
  }
  // The boot script may already have set data-mode, so sync the controls regardless.
  if (root.dataset.mode !== mode) {
    root.dataset.mode = mode;
    updateThemeColor();
  }
  modeSwitch.set(mode);
  if (el.modeLabel.textContent !== MODE_LABELS[mode]) {
    el.modeLabel.textContent = MODE_LABELS[mode];
    if (loaded) animate(el.modeLabel, [{ opacity: 0, transform: "translateY(5px)" }, { opacity: 1, transform: "none" }], { duration: 420, easing: EASE.out });
  }
}

function updateThemeColor() {
  const color = THEME_COLORS[root.dataset.theme]?.[root.dataset.mode] || THEME_COLORS.light.focus;
  $$('meta[name="theme-color"]').forEach((m) => m.setAttribute("content", color));
}

function applyTheme() {
  const pref = store.get().settings.theme;
  const dark = pref === "dark" || (pref === "auto" && darkQuery.matches);
  root.dataset.theme = dark ? "dark" : "light";
  updateThemeColor();
}
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
darkQuery.addEventListener?.("change", applyTheme);

function renderDots(state) {
  const total = state.settings.longInterval;
  const filled = Math.min(state.timer.cycle, total);
  const key = `${total}|${filled}`;
  if (key === lastDotsKey) return;
  const grew = filled > lastCycle && lastDotsKey !== "";
  lastDotsKey = key;
  if (el.dots.children.length !== total) {
    el.dots.innerHTML = Array.from({ length: total }, () => '<span class="dot"></span>').join("");
  }
  [...el.dots.children].forEach((d, i) => d.classList.toggle("is-filled", i < filled));
  el.dots.setAttribute("aria-label", `${filled} of ${total} focus sessions until the long break`);
  if (grew && loaded) {
    const dot = el.dots.children[filled - 1];
    if (dot) {
      animate(dot, [{ transform: "scale(1)" }, { transform: "scale(1.7)" }, { transform: "scale(1)" }], { duration: 620, easing: EASE.spring });
      const r = dot.getBoundingClientRect();
      wave(r.left + r.width / 2, r.top + r.height / 2, 5, { scale: 3.4, duration: 700, width: 1.5 });
    }
  }
  lastCycle = filled;
}

function render(state = store.get()) {
  const t = state.timer;
  root.dataset.status = t.status;
  applyModeAttr(t.mode);

  const playing = t.status === "running";
  morph.set(playing ? "pause" : "play", loaded);
  const playLabel = playing ? "Pause timer" : t.status === "paused" ? "Resume timer" : "Start timer";
  el.play.setAttribute("aria-label", playLabel);
  el.play.dataset.tip = `${playing ? "Pause" : t.status === "paused" ? "Resume" : "Start"} · Space`;
  el.reset.disabled = t.status === "idle" && t.remaining === t.duration;

  renderDots(state);

  if (document.activeElement !== el.task && el.task.value !== t.task) el.task.value = t.task;

  const away = state.meta.awayNotice;
  if (away) {
    el.awayText.textContent = `${away.mode === "focus" ? "Focus session" : "Break"} finished while you were away`;
  }
  el.awayNote.hidden = !away;

  renderToday(todayRefs, state);
  if (currentView === "stats" && statsDirty) refreshStats(false);

  setWakeLock(state.settings.wakeLock && playing && t.mode === "focus");
  audio.setVolume(state.settings.volume);
  frameOnce();
}

/* ======================================================================
   Frame loop — rAF while visible, a coarse interval while hidden
   ====================================================================== */
let raf = 0;
let hiddenTimer = 0;
let lastSecond = -1;
let endTimeout = 0;

function frame(now = performance.now()) {
  raf = 0;
  const wall = Date.now();
  timer.check(wall);
  const t = timer.state;
  const holding = completionHold && now < completionHold.until;
  if (completionHold && !holding) {
    completionHold = null;
    ring.sweep(reducedMotion() ? 200 : 900, 1);
  }
  const remaining = holding ? 0 : timer.remaining(wall);
  ring.render(holding ? 1 : timer.progress(wall), now);
  digits.set(formatClock(remaining), { direction: t.status === "running" ? -1 : undefined });

  const sec = secondsLeft(remaining);
  if (sec !== lastSecond) {
    const prev = lastSecond;
    lastSecond = sec;
    onSecond(remaining, prev);
  }
  if (t.status === "running" || ring.animating || holding) raf = requestAnimationFrame(frame);
}

function frameOnce() {
  if (!raf && !document.hidden) raf = requestAnimationFrame(frame);
  scheduleEnd();
}

/** Per-second work: title, favicon, screen-reader text, optional tick. */
function onSecond(remaining, prev) {
  const state = store.get();
  const t = state.timer;
  tab.update({
    status: t.status,
    label: MODE_LABELS[t.mode],
    time: formatClock(remaining),
    progress: timer.progress(),
    away: Boolean(state.meta.awayNotice),
  });
  const statusWord = t.status === "running" ? "running" : t.status === "paused" ? "paused" : "ready";
  el.timeSr.textContent = `${spokenTime(remaining)} remaining, ${MODE_LABELS[t.mode]}, ${statusWord}`;
  if (t.status === "running" && prev !== -1 && state.settings.tick && state.settings.sound && !document.hidden && remaining > 0) {
    audio.play("tick");
  }
}

/** Best-effort exact wake-up at the phase end (helps background tabs). */
function scheduleEnd() {
  clearTimeout(endTimeout);
  const t = timer.state;
  if (t.status !== "running") return;
  endTimeout = setTimeout(() => {
    if (timer.check()) frameOnce();
  }, Math.max(0, t.endAt - Date.now()) + 30);
}

function onVisibility() {
  if (document.hidden) {
    cancelAnimationFrame(raf);
    raf = 0;
    clearInterval(hiddenTimer);
    hiddenTimer = setInterval(() => {
      timer.check();
      const rem = timer.remaining();
      onSecond(rem, lastSecond);
      lastSecond = secondsLeft(rem);
    }, 1000);
  } else {
    clearInterval(hiddenTimer);
    hiddenTimer = 0;
    // Catch up instantly with the real clock (and today's date).
    timer.check();
    if (loaded) ring.sweep(600);
    statsDirty = true;
    render();
  }
}
document.addEventListener("visibilitychange", onVisibility);
window.addEventListener("pageshow", () => {
  timer.check();
  render();
});

/* ======================================================================
   Timer events: phase-end choreography
   ====================================================================== */
timer.addEventListener("complete", (e) => {
  const { from, to, away, autoStarted, todayCount } = e.detail;
  const state = store.get();
  const s = state.settings;
  const nextLabel = MODE_LABELS[to];

  const message =
    from === "focus"
      ? `Focus session complete. ${autoStarted ? `${nextLabel} started.` : `Time for a ${nextLabel.toLowerCase()}.`}`
      : `${MODE_LABELS[from]} over. ${autoStarted ? "Focus started." : "Ready to focus?"}`;
  announce(message);

  if (!away) {
    if (s.sound) audio.play(from === "focus" ? "focusEnd" : "breakEnd");
    if (s.vibration) vibrate();
  }
  if (s.notifications && (document.hidden || !document.hasFocus())) {
    showNotification(
      from === "focus" ? "Focus session complete" : `${MODE_LABELS[from]} is over`,
      from === "focus" ? (autoStarted ? `${nextLabel} has started.` : `Nice work. Take a ${nextLabel.toLowerCase()}.`) : autoStarted ? "Focus session started." : "Ready for the next focus session?",
    );
  }

  if (!loaded || away || document.hidden) {
    render();
    return;
  }

  // Choreography: ring fills & pulses → counter rolls → palette shifts → ring sweeps.
  completionHold = { until: performance.now() + (reducedMotion() ? 300 : 820) };
  modeHoldUntil = performance.now() + (reducedMotion() ? 0 : 520);
  animate(el.ringSvg, [{ transform: "scale(1)" }, { transform: "scale(1.04)" }, { transform: "scale(1)" }], { duration: 760, easing: EASE.spring });
  animate(el.halo, [{ opacity: 0.6 }, { opacity: 1, transform: "scale(1.08)" }, { opacity: 0.6, transform: "scale(1)" }], { duration: 1100, easing: EASE.out });
  render();

  if (from === "focus") {
    celebrateSession(el.todayCount, el.ringWrap);
    const today = dayKey();
    if (todayCount === s.dailyGoal && state.meta.goalCelebrated !== today) {
      store.update((st) => {
        st.meta.goalCelebrated = today;
      });
      setTimeout(() => {
        celebrateGoal(el.ringWrap);
        if (s.sound) audio.play("goal");
        toast(`Daily goal reached · ${todayCount} sessions`, { icon: "sparkle", duration: 5200 });
      }, 650);
    }
  }
});

timer.addEventListener("mode", () => {
  if (loaded) ring.sweep(760);
});

timer.addEventListener("control", (e) => {
  if (!loaded) return;
  if (e.detail.action === "resume" || e.detail.action === "start") {
    animate(el.ringSvg, [{ transform: "scale(0.975)" }, { transform: "scale(1)" }], { duration: 640, easing: EASE.spring });
  }
  if (e.detail.action === "reset") ring.sweep(640);
});

store.subscribe((state, info) => {
  if (info.action === "settings") {
    if (info.path === "theme") applyTheme();
    if (info.path?.startsWith("durations")) timer.syncDuration();
    settingsUi.sync();
  }
  if (info.replaced || info.external) {
    applyTheme();
    timer.syncDuration();
    settingsUi.sync();
    lastDotsKey = "";
  }
  statsDirty = true;
  render(state);
});

/* ======================================================================
   User actions
   ====================================================================== */

/** Snapshot the timer so a destructive action can be undone. */
function withUndo(label, action) {
  const before = structuredClone(timer.state);
  // Only offer undo when real progress would be lost (live remaining, not the stored snapshot).
  const meaningful = before.status !== "idle" && timer.remaining() < before.duration - 1000;
  action();
  if (!meaningful) return;
  toast(label, {
    icon: "info",
    action: "Undo",
    onAction: () => {
      // A running phase keeps its original end time: the clock never stopped.
      store.update((s) => {
        s.timer = structuredClone(before);
      });
      timer.check();
      ring.sweep(640);
    },
    duration: 5000,
  });
}

function userSetMode(mode) {
  if (mode === timer.state.mode && timer.state.status === "idle") return;
  withUndo(`Switched to ${MODE_LABELS[mode]}`, () => timer.setMode(mode));
}
const userToggle = () => timer.toggle();
const userReset = () => withUndo("Timer reset", () => timer.reset());
const userSkip = () => withUndo(`Skipped to ${MODE_LABELS[timer.nextMode(timer.state.mode, timer.state.cycle)]}`, () => timer.skip());

el.play.addEventListener("click", userToggle);
el.reset.addEventListener("click", userReset);
el.skip.addEventListener("click", userSkip);
ripple(el.play);
magnetic(el.play);

el.task.addEventListener("input", () => {
  const value = el.task.value.slice(0, 80);
  store.update((s) => {
    s.timer.task = value;
  });
});
let taskBefore = "";
el.task.addEventListener("focus", () => (taskBefore = el.task.value));
el.task.addEventListener("keydown", (e) => {
  if (e.key === "Enter") el.task.blur();
  if (e.key === "Escape") {
    e.stopPropagation();
    el.task.value = taskBefore;
    store.update((s) => {
      s.timer.task = taskBefore;
    });
    el.task.blur();
  }
});
el.task.addEventListener("blur", () => {
  const trimmed = el.task.value.trim();
  if (trimmed !== el.task.value) {
    el.task.value = trimmed;
    store.update((s) => {
      s.timer.task = trimmed;
    });
  }
});

/* ======================================================================
   Focus (zen) mode
   ====================================================================== */
let zen = false;
let zenHintTimer = 0;
const zenTargets = [
  [$(".today"), 0],
  [$(".kbd-hint"), 0],
  [$(".controls"), 50],
  [$(".task"), 100],
  [$("#mode-switch"), 150],
  [$(".topbar"), 200],
];
zenTargets.forEach(([node]) => node.classList.add("zen-out"));

function placeZenRing() {
  const r = el.ringWrap.getBoundingClientRect();
  const cs = getComputedStyle(el.ringWrap);
  const curX = parseFloat(cs.getPropertyValue("--zen-x")) || 0;
  const curY = parseFloat(cs.getPropertyValue("--zen-y")) || 0;
  const curS = parseFloat(cs.getPropertyValue("--zen-s")) || 1;
  const baseW = r.width / curS;
  const cx = r.left + r.width / 2 - curX;
  const cy = r.top + r.height / 2 - curY;
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const scale = Math.min(1.22, (Math.min(vw, vh) * 0.82) / baseW);
  el.ringWrap.style.setProperty("--zen-x", `${vw / 2 - cx}px`);
  el.ringWrap.style.setProperty("--zen-y", `${vh / 2 - cy}px`);
  el.ringWrap.style.setProperty("--zen-s", String(Math.max(1, scale)));
}

function setZen(on) {
  if (on === zen) return;
  zen = on;
  const total = 200;
  zenTargets.forEach(([node, delay]) => node.style.setProperty("--zen-delay", `${on ? delay : total - delay}ms`));
  if (on) {
    placeZenRing();
    root.classList.add("is-zen");
    el.zenExit.tabIndex = 0;
    el.zenBtn.setAttribute("aria-pressed", "true");
    el.zenHint.classList.add("is-visible");
    clearTimeout(zenHintTimer);
    zenHintTimer = setTimeout(() => el.zenHint.classList.remove("is-visible"), 3600);
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();
    el.zenExit.focus({ preventScroll: true });
  } else {
    root.classList.remove("is-zen");
    ["--zen-x", "--zen-y", "--zen-s"].forEach((p) => el.ringWrap.style.removeProperty(p));
    el.zenExit.tabIndex = -1;
    el.zenBtn.setAttribute("aria-pressed", "false");
    el.zenHint.classList.remove("is-visible");
    el.zenBtn.focus({ preventScroll: true });
  }
}
el.zenBtn.addEventListener("click", () => setZen(true));
el.zenExit.addEventListener("click", () => setZen(false));
el.ringWrap.addEventListener("click", () => {
  if (zen) timer.toggle();
});
window.addEventListener("resize", () => {
  if (zen) placeZenRing();
  if (currentView === "stats") statsHandle?.redraw();
});

/* ======================================================================
   Views: timer ⇄ statistics (View Transitions API with CSS fallback)
   ====================================================================== */
let currentView = "timer";
let statsDirty = true;
let statsHandle = null;

function refreshStats(animateIn) {
  statsHandle = renderStats(el.statsBody, store.get(), { animateIn });
  statsDirty = false;
}

async function showView(name, { fromHash = false } = {}) {
  if (name === currentView) return;
  if (zen) setZen(false);
  const incoming = name === "stats" ? el.statsView : el.timerView;
  const outgoing = name === "stats" ? el.timerView : el.statsView;
  currentView = name;
  if (!fromHash) {
    if (name === "stats") history.pushState({ view: "stats" }, "", "#stats");
    else if (history.state?.view === "stats") history.back();
    else if (location.hash) history.replaceState(null, "", location.pathname + location.search);
  }
  const swap = () => {
    outgoing.hidden = true;
    incoming.hidden = false;
    el.statsView.classList.toggle("is-shown", name === "stats");
    if (name === "stats") refreshStats(true);
    el.statsBtn.setAttribute("aria-pressed", String(name === "stats"));
    window.scrollTo(0, 0);
  };
  if (document.startViewTransition && !reducedMotion()) {
    try {
      await document.startViewTransition(swap).updateCallbackDone;
    } catch {
      swap();
    }
  } else {
    outgoing.classList.add("is-leaving");
    await new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 200));
    outgoing.classList.remove("is-leaving");
    swap();
    incoming.classList.add("is-entering");
    setTimeout(() => incoming.classList.remove("is-entering"), 560);
  }
  (name === "stats" ? $("#stats-title") : el.play).focus?.({ preventScroll: true });
}
el.statsBtn.addEventListener("click", () => showView(currentView === "stats" ? "timer" : "stats"));
$("#btn-open-stats").addEventListener("click", () => showView("stats"));
$("#btn-stats-back").addEventListener("click", () => showView("timer"));
$("#stats-title").tabIndex = -1;
window.addEventListener("popstate", () => showView(location.hash === "#stats" ? "stats" : "timer", { fromHash: true }));

/* ======================================================================
   Layers
   ====================================================================== */
const settingsLayer = new Layer($("#settings-layer"), { draggable: true });
const shortcutsLayer = new Layer($("#shortcuts-layer"));
const settingsUi = initSettings($("#settings-body"), {
  store,
  onPreviewSound: () => {
    audio.unlock();
    audio.play("focusEnd");
  },
  onToast: (msg, iconName) => toast(msg, { icon: iconName }),
});
el.settingsBtn.addEventListener("click", () => settingsLayer.open());

/* ======================================================================
   Keyboard shortcuts
   ====================================================================== */
document.addEventListener("keydown", (e) => {
  if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
  const target = e.target;
  const typing = target.closest?.("input, textarea, select, [contenteditable='true']");
  if (typing) return;
  if (topLayer()) return; // layers handle their own keys (Esc, Tab)
  const onControl = target.closest?.("button, a, [role='switch'], [role='radio']");
  const key = e.key;

  if (key === "Escape") {
    if (zen) setZen(false);
    else if (currentView === "stats") showView("timer");
    return;
  }
  if (key === " " || key === "Spacebar") {
    if (onControl && !zen) return; // let Space activate the focused control
    e.preventDefault();
    userToggle();
    return;
  }
  const lower = key.toLowerCase();
  if (currentView === "timer") {
    if (lower === "r") return userReset();
    if (lower === "s") return userSkip();
    if (key === "1" || key === "2" || key === "3") return userSetMode(MODES[Number(key) - 1]);
    if (lower === "z") return setZen(!zen);
  }
  if (lower === "t") return showView(currentView === "stats" ? "timer" : "stats");
  if (key === ",") {
    e.preventDefault();
    if (zen) setZen(false);
    return settingsLayer.open();
  }
  if (key === "?") {
    e.preventDefault();
    return shortcutsLayer.open();
  }
});

/* ======================================================================
   Midnight rollover: "today" resets at local midnight
   ====================================================================== */
function scheduleMidnight() {
  const now = new Date();
  const next = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 0, 1);
  setTimeout(() => {
    statsDirty = true;
    render();
    scheduleMidnight();
  }, next - now);
}

/* ======================================================================
   Service worker (offline + clean updates)
   ====================================================================== */
function registerServiceWorker() {
  if (!("serviceWorker" in navigator) || location.protocol === "file:") return;
  let userAskedToUpdate = false;
  navigator.serviceWorker.addEventListener("controllerchange", () => {
    if (userAskedToUpdate) location.reload();
  });
  navigator.serviceWorker
    .register("./sw.js", { scope: "./" })
    .then((reg) => {
      const offer = (worker) => {
        toast("A new version is ready", {
          icon: "refresh",
          action: "Update",
          duration: 0,
          onAction: () => {
            userAskedToUpdate = true;
            worker.postMessage({ type: "SKIP_WAITING" });
          },
        });
      };
      if (reg.waiting && navigator.serviceWorker.controller) offer(reg.waiting);
      reg.addEventListener("updatefound", () => {
        const worker = reg.installing;
        worker?.addEventListener("statechange", () => {
          if (worker.state === "installed" && navigator.serviceWorker.controller) offer(worker);
        });
      });
    })
    .catch(() => {});
}

/* ======================================================================
   Boot
   ====================================================================== */
function boot() {
  applyTheme();
  audio.installUnlock();

  // Restore: if a phase ended while the app was closed, complete it now.
  timer.check();
  timer.syncDuration();

  digits.set(formatClock(completionHold ? 0 : timer.remaining()), { instant: true });
  ring.render(0);
  render();

  const fontsReady = document.fonts?.ready ?? Promise.resolve();
  Promise.race([fontsReady, new Promise((r) => setTimeout(r, 500))]).then(() => {
    requestAnimationFrame(() => {
      root.classList.add("is-loaded");
      // The ring draws itself, then progress sweeps to where we are.
      setTimeout(() => {
        loaded = true;
        ring.sweep(reducedMotion() ? 200 : 1100, 0);
        frameOnce();
      }, reducedMotion() ? 0 : 480);
      setTimeout(() => root.classList.add("is-ready"), 120);
    });
  });

  scheduleMidnight();
  if (location.hash === "#stats") showView("stats", { fromHash: true });
  if (document.readyState === "complete") registerServiceWorker();
  else window.addEventListener("load", registerServiceWorker, { once: true });
}

boot();
