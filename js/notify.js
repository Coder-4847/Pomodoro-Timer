/**
 * notify.js — system notifications, haptics and the screen wake lock.
 * Every API here is optional; unsupported or denied features fail silently.
 */

export const platform = (() => {
  const ua = navigator.userAgent || "";
  const iOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone =
    window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
  return { iOS, standalone };
})();

/* ---- Notifications --------------------------------------------------- */

/**
 * Describe what the notification feature can do right now:
 * "granted" | "denied" | "default" | "unsupported" | "ios-install"
 */
export function notificationStatus() {
  if (!("Notification" in window)) return platform.iOS && !platform.standalone ? "ios-install" : "unsupported";
  return Notification.permission;
}

/** Ask for permission (only ever called from the settings toggle). */
export async function requestNotificationPermission() {
  if (!("Notification" in window)) return notificationStatus();
  try {
    const result = await Notification.requestPermission();
    return result;
  } catch {
    return Notification.permission;
  }
}

export async function showNotification(title, body) {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  const options = {
    body,
    icon: "./assets/icons/icon-192.png",
    badge: "./assets/icons/badge-72.png",
    tag: "pomodoro-phase",
    renotify: true,
    silent: true, // we play our own chime
  };
  try {
    // Android Chrome requires notifications to come from the service worker.
    const reg = navigator.serviceWorker && (await navigator.serviceWorker.getRegistration());
    if (reg && reg.showNotification) {
      await reg.showNotification(title, options);
      return;
    }
    new Notification(title, options);
  } catch {
    /* ignore */
  }
}

/* ---- Haptics -------------------------------------------------------- */
export function vibrate(pattern = [70, 90, 70]) {
  try {
    // Vibration also requires a prior user gesture.
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
    if (navigator.vibrate) navigator.vibrate(pattern);
  } catch {
    /* ignore */
  }
}

/* ---- Screen wake lock ---------------------------------------------- */
let sentinel = null;
let pending = false;
let wanted = false;

export const wakeLockSupported = () => "wakeLock" in navigator;

async function acquire() {
  if (!wakeLockSupported() || sentinel || pending || document.visibilityState !== "visible") return;
  pending = true;
  try {
    const lock = await navigator.wakeLock.request("screen");
    lock.addEventListener("release", () => {
      if (sentinel === lock) sentinel = null;
    });
    sentinel = lock;
    // The wish may have changed while we waited for the lock.
    if (!wanted) release();
  } catch {
    sentinel = null;
  } finally {
    pending = false;
  }
}

async function release() {
  const s = sentinel;
  sentinel = null;
  try {
    await s?.release();
  } catch {
    /* ignore */
  }
}

/** Declare whether the screen should stay awake; re-acquired on return. */
export function setWakeLock(on) {
  wanted = on;
  if (on) acquire();
  else release();
}

document.addEventListener("visibilitychange", () => {
  if (wanted && document.visibilityState === "visible") acquire();
});
