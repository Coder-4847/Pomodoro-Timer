/**
 * audio.js — every sound is synthesised with the Web Audio API.
 *
 * Bells are built from a few slightly inharmonic sine partials with soft
 * attacks and long exponential tails, through a gentle low-pass, so they read
 * as "chime" rather than "beep". No audio files ship with the app.
 *
 * iOS/Safari only allows audio after a user gesture, so `installUnlock`
 * resumes the context (and plays one silent sample) on the first tap/key.
 */

let ctx = null;
let master = null;
let volume = 0.7;

function ensureContext() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  try {
    ctx = new AC({ latencyHint: "interactive" });
    master = ctx.createGain();
    master.gain.value = perceptual(volume);
    // A touch of low-pass keeps every tone soft on cheap speakers.
    const tone = ctx.createBiquadFilter();
    tone.type = "lowpass";
    tone.frequency.value = 5200;
    tone.Q.value = 0.4;
    master.connect(tone).connect(ctx.destination);
  } catch {
    ctx = null;
  }
  return ctx;
}

const perceptual = (v) => Math.pow(Math.max(0, Math.min(1, v)), 1.8) * 0.9;

export function setVolume(v) {
  volume = v;
  if (master && ctx) master.gain.setTargetAtTime(perceptual(v), ctx.currentTime, 0.03);
}

/** Resume the context inside a user gesture (required by iOS Safari). */
export function unlock() {
  const c = ensureContext();
  if (!c) return;
  if (c.state === "suspended" || c.state === "interrupted") c.resume().catch(() => {});
  try {
    const buffer = c.createBuffer(1, 1, 22050);
    const src = c.createBufferSource();
    src.buffer = buffer;
    src.connect(c.destination);
    src.start(0);
  } catch {
    /* ignore */
  }
}

export function installUnlock() {
  const events = ["pointerdown", "keydown", "touchend"];
  const handler = () => {
    unlock();
    if (ctx && ctx.state === "running") events.forEach((e) => window.removeEventListener(e, handler, true));
  };
  events.forEach((e) => window.addEventListener(e, handler, { capture: true, passive: true }));
}

/** One bell voice: fundamental + soft, slightly stretched partials. */
function bell(freq, at, { gain = 0.3, decay = 2.4, brightness = 1 } = {}) {
  const partials = [
    [1, 1, 1],
    [2.001, 0.32 * brightness, 0.7],
    [3.006, 0.1 * brightness, 0.45],
    [4.18, 0.05 * brightness, 0.3],
  ];
  for (const [ratio, amp, decayScale] of partials) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq * ratio;
    // a hair of detune gives a living shimmer
    osc.detune.value = (Math.random() - 0.5) * 4;
    const peak = gain * amp;
    const end = at + decay * decayScale;
    env.gain.setValueAtTime(0.0001, at);
    env.gain.linearRampToValueAtTime(peak, at + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, end);
    osc.connect(env).connect(master);
    osc.start(at);
    osc.stop(end + 0.05);
  }
}

/** Short, very quiet click for the optional per-second tick. */
function tick(at) {
  const len = Math.floor(ctx.sampleRate * 0.03);
  const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
  const src = ctx.createBufferSource();
  const bp = ctx.createBiquadFilter();
  const env = ctx.createGain();
  bp.type = "bandpass";
  bp.frequency.value = 2400;
  bp.Q.value = 1.2;
  env.gain.value = 0.05;
  src.buffer = buffer;
  src.connect(bp).connect(env).connect(master);
  src.start(at);
}

const NOTE = {
  C5: 523.25,
  E5: 659.25,
  G5: 783.99,
  A5: 880,
  B5: 987.77,
  C6: 1046.5,
  D6: 1174.66,
  E6: 1318.51,
  Gs5: 830.61,
};

/**
 * Play a named cue.
 *  - focusEnd: bright, rising major triad → "well done, take a breath"
 *  - breakEnd: two warm descending notes → "back to it"
 *  - goal:     a fuller four-note arpeggio for hitting the daily goal
 *  - tick:     barely-there click
 */
/** Browsers refuse audio before the first user gesture; stay silent until then. */
const mayPlay = () => ctx !== null || !navigator.userActivation || navigator.userActivation.hasBeenActive;

export function play(kind) {
  if (!mayPlay()) return;
  const c = ensureContext();
  if (!c) return;
  if (c.state !== "running") c.resume().catch(() => {});
  const t = c.currentTime + 0.03;
  switch (kind) {
    case "focusEnd":
      bell(NOTE.E5, t, { gain: 0.26, decay: 2.6 });
      bell(NOTE.Gs5, t + 0.17, { gain: 0.22, decay: 2.6 });
      bell(NOTE.B5, t + 0.34, { gain: 0.22, decay: 3.2 });
      break;
    case "breakEnd":
      bell(NOTE.A5, t, { gain: 0.24, decay: 2.2, brightness: 0.7 });
      bell(NOTE.E5, t + 0.32, { gain: 0.26, decay: 3, brightness: 0.7 });
      break;
    case "goal":
      bell(NOTE.C5, t, { gain: 0.2, decay: 2.8 });
      bell(NOTE.E5, t + 0.12, { gain: 0.2, decay: 2.8 });
      bell(NOTE.G5, t + 0.24, { gain: 0.2, decay: 2.8 });
      bell(NOTE.C6, t + 0.36, { gain: 0.22, decay: 3.6 });
      bell(NOTE.E6, t + 0.5, { gain: 0.08, decay: 3.6, brightness: 0.4 });
      break;
    case "tick":
      tick(t);
      break;
    default:
      break;
  }
}
