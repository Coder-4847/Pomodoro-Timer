/**
 * storage.js — a tiny, failure-proof wrapper around localStorage.
 *
 * Storage can be blocked (private mode, disabled cookies, quota exceeded).
 * In that case we silently fall back to an in-memory copy so the app keeps
 * working for the current visit.
 */

export const STORAGE_KEY = "pomodoro-timer/v1";

let memoryCopy = null;

const available = (() => {
  try {
    const probe = "__pomodoro_probe__";
    window.localStorage.setItem(probe, "1");
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
})();

/** Whether data will survive a reload. */
export const isPersistent = () => available;

/** Read and parse the saved blob. Never throws; returns null if absent or corrupt. */
export function readRaw() {
  try {
    const raw = available ? window.localStorage.getItem(STORAGE_KEY) : memoryCopy;
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

/** Serialise and save. Falls back to memory when storage throws (e.g. quota). */
export function writeRaw(data) {
  let raw;
  try {
    raw = JSON.stringify(data);
  } catch {
    return false;
  }
  if (available) {
    try {
      window.localStorage.setItem(STORAGE_KEY, raw);
      return true;
    } catch {
      /* fall through to memory */
    }
  }
  memoryCopy = raw;
  return false;
}

export function clearRaw() {
  memoryCopy = null;
  if (!available) return;
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/** Notify when another tab changes our data. */
export function onExternalChange(callback) {
  if (!available) return;
  window.addEventListener("storage", (event) => {
    if (event.key !== STORAGE_KEY) return;
    try {
      callback(event.newValue ? JSON.parse(event.newValue) : null);
    } catch {
      /* ignore malformed writes */
    }
  });
}
