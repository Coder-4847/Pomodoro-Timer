/**
 * state.js — schema, defaults, validation and a minimal reactive store.
 *
 * Everything the app remembers lives in one versioned object:
 *   { version, settings, timer, sessions, days, meta }
 * Anything loaded from storage or an import file goes through `sanitize`,
 * so a corrupt or hand-edited blob can never crash the app.
 */

import { readRaw, writeRaw, onExternalChange } from "./storage.js";

export const SCHEMA_VERSION = 1;
export const MODES = ["focus", "short", "long"];
export const MODE_LABELS = { focus: "Focus", short: "Short Break", long: "Long Break" };
export const MAX_SESSIONS = 500; // detailed history kept for the "recent" lists
export const MAX_DAYS = 3650; // daily aggregates (~10 years) power streaks & totals

export const LIMITS = {
  focus: [1, 99],
  short: [1, 60],
  long: [1, 60],
  longInterval: [2, 8],
  dailyGoal: [1, 24],
};

export const DEFAULT_SETTINGS = Object.freeze({
  durations: { focus: 25, short: 5, long: 15 },
  longInterval: 4,
  autoStartBreaks: false,
  autoStartFocus: false,
  sound: true,
  volume: 0.7,
  tick: false,
  notifications: false,
  vibration: true,
  wakeLock: true,
  theme: "auto",
  dailyGoal: 8,
});

/** Local calendar day as YYYY-MM-DD (midnight rollover follows the user's clock). */
export function dayKey(ts = Date.now()) {
  const d = new Date(ts);
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${m}-${day}`;
}

export const minutesToMs = (min) => Math.round(min * 60000);

export function defaultState() {
  const settings = structuredClone(DEFAULT_SETTINGS);
  const duration = minutesToMs(settings.durations.focus);
  return {
    version: SCHEMA_VERSION,
    settings,
    timer: {
      mode: "focus",
      status: "idle", // idle | running | paused
      duration, // ms length of the current phase
      remaining: duration, // ms left when idle/paused
      endAt: null, // absolute epoch ms when running
      startedAt: null, // first start of this phase
      cycle: 0, // focus sessions completed toward the long break
      task: "",
    },
    sessions: [], // { id, start, end, duration, task }
    days: {}, // { "YYYY-MM-DD": { count, ms } }
    meta: { goalCelebrated: null, awayNotice: null },
  };
}

/* ---- Validation helpers ---------------------------------------------- */
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const num = (v, min, max, fallback) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : fallback;
const int = (v, min, max, fallback) => Math.round(num(v, min, max, fallback));
const bool = (v, fallback) => (typeof v === "boolean" ? v : fallback);
const oneOf = (v, list, fallback) => (list.includes(v) ? v : fallback);
const str = (v, max, fallback = "") => (typeof v === "string" ? v.slice(0, max) : fallback);
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

/** Turn any value into a valid state object (missing pieces get defaults). */
export function sanitize(raw) {
  const base = defaultState();
  if (!isObj(raw)) return base;
  const data = migrate(raw);

  // settings
  const s = isObj(data.settings) ? data.settings : {};
  const d = isObj(s.durations) ? s.durations : {};
  const D = DEFAULT_SETTINGS;
  base.settings = {
    durations: {
      focus: int(d.focus, ...LIMITS.focus, D.durations.focus),
      short: int(d.short, ...LIMITS.short, D.durations.short),
      long: int(d.long, ...LIMITS.long, D.durations.long),
    },
    longInterval: int(s.longInterval, ...LIMITS.longInterval, D.longInterval),
    autoStartBreaks: bool(s.autoStartBreaks, D.autoStartBreaks),
    autoStartFocus: bool(s.autoStartFocus, D.autoStartFocus),
    sound: bool(s.sound, D.sound),
    volume: num(s.volume, 0, 1, D.volume),
    tick: bool(s.tick, D.tick),
    notifications: bool(s.notifications, D.notifications),
    vibration: bool(s.vibration, D.vibration),
    wakeLock: bool(s.wakeLock, D.wakeLock),
    theme: oneOf(s.theme, ["light", "dark", "auto"], D.theme),
    dailyGoal: int(s.dailyGoal, ...LIMITS.dailyGoal, D.dailyGoal),
  };

  // timer
  const t = isObj(data.timer) ? data.timer : {};
  const mode = oneOf(t.mode, MODES, "focus");
  const fallbackDuration = minutesToMs(base.settings.durations[mode]);
  const duration = int(t.duration, 1000, minutesToMs(120), fallbackDuration);
  const status = oneOf(t.status, ["idle", "running", "paused"], "idle");
  const endAt = typeof t.endAt === "number" && Number.isFinite(t.endAt) ? t.endAt : null;
  base.timer = {
    mode,
    status: status === "running" && endAt === null ? "paused" : status,
    duration,
    remaining: int(t.remaining, 0, duration, duration),
    endAt: status === "running" ? endAt : null,
    startedAt: typeof t.startedAt === "number" ? t.startedAt : null,
    cycle: int(t.cycle, 0, LIMITS.longInterval[1], 0),
    task: str(t.task, 80),
  };

  // sessions (newest last)
  if (Array.isArray(data.sessions)) {
    base.sessions = data.sessions
      .filter((r) => isObj(r) && typeof r.end === "number" && Number.isFinite(r.end))
      .map((r) => ({
        id: str(r.id, 40) || `s${r.end}`,
        start: typeof r.start === "number" ? r.start : r.end - (r.duration || 0),
        end: r.end,
        duration: int(r.duration, 0, minutesToMs(120), 0),
        task: str(r.task, 80),
      }))
      .sort((a, b) => a.end - b.end)
      .slice(-MAX_SESSIONS);
  }

  // daily aggregates
  if (isObj(data.days)) {
    const keys = Object.keys(data.days).filter((k) => DAY_RE.test(k)).sort().slice(-MAX_DAYS);
    for (const k of keys) {
      const v = data.days[k];
      if (!isObj(v)) continue;
      const count = int(v.count, 0, 1000, 0);
      if (count > 0) base.days[k] = { count, ms: int(v.ms, 0, 86400000, 0) };
    }
  }

  const m = isObj(data.meta) ? data.meta : {};
  base.meta = {
    goalCelebrated: typeof m.goalCelebrated === "string" && DAY_RE.test(m.goalCelebrated) ? m.goalCelebrated : null,
    awayNotice: isObj(m.awayNotice) ? { mode: oneOf(m.awayNotice.mode, MODES, "focus"), at: num(m.awayNotice.at, 0, 1e15, 0) } : null,
  };
  return base;
}

/** Upgrade older schema versions in place. Add a case per future version. */
function migrate(data) {
  const version = typeof data.version === "number" ? data.version : 1;
  // (v1 is the first schema; nothing to migrate yet.)
  if (version > SCHEMA_VERSION) {
    // Data from a newer build: keep what we understand.
    return { ...data, version: SCHEMA_VERSION };
  }
  return data;
}

/* ---- Store ----------------------------------------------------------- */

/**
 * A minimal store: `update(recipe)` mutates a draft in place, then notifies
 * subscribers and schedules a single persisted write per microtask.
 */
export function createStore() {
  let state = sanitize(readRaw());
  const listeners = new Set();
  let writeQueued = false;

  const persist = () => {
    if (writeQueued) return;
    writeQueued = true;
    queueMicrotask(() => {
      writeQueued = false;
      writeRaw(state);
    });
  };

  const emit = (info) => {
    for (const fn of listeners) fn(state, info);
  };

  // Keep tabs in sync: if another tab writes, adopt its state.
  onExternalChange((raw) => {
    state = sanitize(raw);
    emit({ external: true });
  });

  persist();

  return {
    get: () => state,
    update(recipe, info = {}) {
      recipe(state);
      persist();
      emit(info);
    },
    replace(next, info = {}) {
      state = sanitize(next);
      persist();
      emit({ ...info, replaced: true });
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
