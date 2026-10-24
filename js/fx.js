/**
 * fx.js — tasteful micro-celebrations: soft particle bursts and ring waves.
 * Everything is transform/opacity on a fixed overlay and removed afterwards.
 */

import { animate, reducedMotion, EASE } from "./ui.js";

const layer = () => document.getElementById("fx-layer");

function palette() {
  const cs = getComputedStyle(document.documentElement);
  return ["--ring-a", "--ring-b", "--accent", "--accent-soft"].map((v) => cs.getPropertyValue(v).trim());
}

const centerOf = (el) => {
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, r: Math.min(r.width, r.height) / 2 };
};

/** Particles drifting outward from a point (or from a circle's edge). */
export function burst(x, y, { count = 14, radius = 0, distance = [36, 78], size = [4, 8], duration = [700, 1100] } = {}) {
  const host = layer();
  if (!host || reducedMotion()) return;
  const colors = palette();
  for (let i = 0; i < count; i++) {
    const p = document.createElement("span");
    p.className = "particle";
    const s = size[0] + Math.random() * (size[1] - size[0]);
    p.style.width = p.style.height = `${s}px`;
    p.style.background = colors[i % colors.length];
    host.append(p);
    const angle = (i / count) * Math.PI * 2 + Math.random() * 0.5;
    const d = distance[0] + Math.random() * (distance[1] - distance[0]);
    const sx = x + Math.cos(angle) * radius;
    const sy = y + Math.sin(angle) * radius;
    const ex = sx + Math.cos(angle) * d;
    const ey = sy + Math.sin(angle) * d - 10; // a hint of lift
    const dur = duration[0] + Math.random() * (duration[1] - duration[0]);
    animate(
      p,
      [
        { transform: `translate(${sx}px, ${sy}px) scale(0.4)`, opacity: 0 },
        { transform: `translate(${sx + (ex - sx) * 0.35}px, ${sy + (ey - sy) * 0.35}px) scale(1)`, opacity: 1, offset: 0.18 },
        { transform: `translate(${ex}px, ${ey}px) scale(0.2)`, opacity: 0 },
      ],
      { duration: dur, easing: EASE.out, delay: Math.random() * 90 },
    ).then(() => p.remove());
  }
}

/** An expanding, fading circle. */
export function wave(x, y, r, { scale = 1.5, duration = 900, delay = 0, width = 2 } = {}) {
  const host = layer();
  if (!host || reducedMotion()) return;
  const ring = document.createElement("span");
  ring.className = "burst-ring";
  ring.style.width = ring.style.height = `${r * 2}px`;
  ring.style.borderWidth = `${width}px`;
  ring.style.left = `${x - r}px`;
  ring.style.top = `${y - r}px`;
  host.append(ring);
  animate(ring, [
    { transform: "scale(0.92)", opacity: 0.55 },
    { transform: `scale(${scale})`, opacity: 0 },
  ], { duration, delay, easing: EASE.out }).then(() => ring.remove());
}

/** Session complete: a small burst from the counter and a ring pulse. */
export function celebrateSession(counterEl, ringEl) {
  if (counterEl) {
    const c = centerOf(counterEl);
    burst(c.x, c.y, { count: 12, distance: [26, 54], size: [3, 6] });
    wave(c.x, c.y, Math.max(16, c.r), { scale: 2.2, duration: 800 });
  }
  if (ringEl) {
    const c = centerOf(ringEl);
    wave(c.x, c.y, c.r * 0.95, { scale: 1.18, duration: 1000, width: 2 });
  }
}

/** Daily goal reached: particles bloom from the ring's circumference. */
export function celebrateGoal(ringEl) {
  if (!ringEl) return;
  const c = centerOf(ringEl);
  burst(c.x, c.y, { count: 32, radius: c.r * 0.92, distance: [30, 110], size: [4, 9], duration: [1000, 1700] });
  wave(c.x, c.y, c.r * 0.95, { scale: 1.3, duration: 1200 });
  wave(c.x, c.y, c.r * 0.95, { scale: 1.55, duration: 1500, delay: 180, width: 1.5 });
}
