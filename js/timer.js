/**
 * timer.js — the timing engine.
 *
 * Accuracy rule: we never count ticks. A running phase stores an absolute
 * `endAt` timestamp; remaining time is always `endAt - Date.now()`. Throttled
 * tabs, sleeping laptops and locked phones therefore can't drift the clock —
 * the next check simply sees the true time and catches up.
 */

import { dayKey, minutesToMs, MAX_SESSIONS, MAX_DAYS } from "./state.js";

/** A phase that ended this long before we noticed counts as "while you were away". */
export const AWAY_THRESHOLD_MS = 90 * 1000;

export class Timer extends EventTarget {
  constructor(store) {
    super();
    this.store = store;
  }

  get state() {
    return this.store.get().timer;
  }

  get settings() {
    return this.store.get().settings;
  }

  durationFor(mode) {
    return minutesToMs(this.settings.durations[mode]);
  }

  /** Milliseconds left in the current phase. */
  remaining(now = Date.now()) {
    const t = this.state;
    if (t.status === "running") return Math.max(0, t.endAt - now);
    return t.remaining;
  }

  /** 0 → 1 progress through the current phase. */
  progress(now = Date.now()) {
    const t = this.state;
    if (!t.duration) return 0;
    return Math.min(1, Math.max(0, 1 - this.remaining(now) / t.duration));
  }

  #emit(type, detail = {}) {
    this.dispatchEvent(new CustomEvent(type, { detail }));
  }

  start() {
    const t = this.state;
    if (t.status === "running") return;
    const now = Date.now();
    const resumed = t.status === "paused";
    this.store.update((s) => {
      s.timer.status = "running";
      s.timer.endAt = now + s.timer.remaining;
      if (!s.timer.startedAt) s.timer.startedAt = now;
      s.meta.awayNotice = null;
    }, { action: resumed ? "resume" : "start" });
    this.#emit("control", { action: resumed ? "resume" : "start" });
  }

  pause() {
    const t = this.state;
    if (t.status !== "running") return;
    const now = Date.now();
    this.store.update((s) => {
      s.timer.remaining = Math.max(0, s.timer.endAt - now);
      s.timer.endAt = null;
      s.timer.status = "paused";
    }, { action: "pause" });
    this.#emit("control", { action: "pause" });
  }

  toggle() {
    if (this.state.status === "running") this.pause();
    else this.start();
  }

  /** Back to the full duration of the current phase. */
  reset() {
    this.store.update((s) => {
      const duration = this.durationFor(s.timer.mode);
      Object.assign(s.timer, { status: "idle", duration, remaining: duration, endAt: null, startedAt: null });
      s.meta.awayNotice = null;
    }, { action: "reset" });
    this.#emit("control", { action: "reset" });
  }

  /** Manually choose a phase (segmented control / 1-2-3 keys). */
  setMode(mode) {
    const from = this.state.mode;
    this.store.update((s) => {
      const duration = this.durationFor(mode);
      Object.assign(s.timer, { mode, status: "idle", duration, remaining: duration, endAt: null, startedAt: null });
      s.meta.awayNotice = null;
    }, { action: "mode" });
    this.#emit("mode", { from, to: mode, reason: "manual" });
  }

  /** Jump to the next phase without counting the current one. */
  skip() {
    const t = this.state;
    const from = t.mode;
    const next = this.nextMode(from, t.cycle);
    this.store.update((s) => {
      if (from === "long") s.timer.cycle = 0;
      this.#enterPhase(s, next, false, Date.now());
      s.meta.awayNotice = null;
    }, { action: "skip" });
    this.#emit("mode", { from, to: next, reason: "skip" });
  }

  nextMode(mode, cycle) {
    if (mode !== "focus") return "focus";
    return cycle >= this.settings.longInterval ? "long" : "short";
  }

  /** Configure the store's timer for a new phase (optionally already running). */
  #enterPhase(s, mode, autoStart, startAt) {
    const duration = this.durationFor(mode);
    Object.assign(s.timer, {
      mode,
      duration,
      remaining: duration,
      status: autoStart ? "running" : "idle",
      endAt: autoStart ? startAt + duration : null,
      startedAt: autoStart ? startAt : null,
    });
  }

  /**
   * Called every frame (or every second while hidden). Completes the phase
   * once the wall clock has passed `endAt` — however late we are.
   */
  check(now = Date.now()) {
    const t = this.state;
    if (t.status !== "running" || now < t.endAt) return false;
    this.#complete(now);
    return true;
  }

  #complete(now) {
    const t = this.state;
    const s0 = this.settings;
    const endedAt = t.endAt;
    const away = now - endedAt > AWAY_THRESHOLD_MS;
    const from = t.mode;
    let record = null;
    let next;
    let autoStarted = false;
    let todayCount = 0;

    this.store.update((s) => {
      if (from === "focus") {
        record = {
          id: `s${endedAt.toString(36)}${Math.random().toString(36).slice(2, 6)}`,
          start: t.startedAt ?? endedAt - t.duration,
          end: endedAt,
          duration: t.duration,
          task: t.task.trim(),
        };
        s.sessions.push(record);
        if (s.sessions.length > MAX_SESSIONS) s.sessions.splice(0, s.sessions.length - MAX_SESSIONS);
        const key = dayKey(endedAt);
        const day = s.days[key] || (s.days[key] = { count: 0, ms: 0 });
        day.count += 1;
        day.ms += t.duration;
        const keys = Object.keys(s.days);
        if (keys.length > MAX_DAYS) for (const k of keys.sort().slice(0, keys.length - MAX_DAYS)) delete s.days[k];
        s.timer.cycle = Math.min(s.timer.cycle + 1, s0.longInterval);
      }
      next = this.nextMode(from, s.timer.cycle);
      if (from === "long") s.timer.cycle = 0;

      // Auto-start only when we caught the end live; after a long absence the
      // user returns to a calm, idle next phase instead of a half-gone timer.
      const wantsAuto = next === "focus" ? s0.autoStartFocus : s0.autoStartBreaks;
      autoStarted = wantsAuto && !away;
      // Start the next phase from the moment the previous one actually ended,
      // so the schedule never drifts even if this check ran a little late.
      this.#enterPhase(s, next, autoStarted, autoStarted ? endedAt : now);
      if (autoStarted && s.timer.endAt <= now) {
        s.timer.endAt = now + s.timer.duration;
        s.timer.startedAt = now;
      }
      s.meta.awayNotice = away ? { mode: from, at: endedAt } : null;
      todayCount = s.days[dayKey(now)]?.count ?? 0;
    }, { action: "complete" });

    this.#emit("complete", { from, to: next, away, record, autoStarted, endedAt, todayCount });
  }

  /** Apply edited durations to an idle phase immediately. */
  syncDuration() {
    const t = this.state;
    if (t.status !== "idle") return;
    const duration = this.durationFor(t.mode);
    if (duration === t.duration && t.remaining === duration) return;
    this.store.update((s) => {
      s.timer.duration = duration;
      s.timer.remaining = duration;
    }, { action: "duration" });
  }
}
