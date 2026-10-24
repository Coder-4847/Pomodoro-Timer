/**
 * ui.js — reusable interface primitives:
 * odometer digits, progress ring, play/pause morph, segmented control,
 * toasts, layers (sheet/modal with focus trap + drag-to-dismiss),
 * ripple and magnetic hover, number tweening.
 */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
export const reducedMotion = () => motionQuery.matches;

const supportsLinear = window.CSS?.supports?.("transition-timing-function", "linear(0, 1)");

/** Shared easing curves for WAAPI (mirrors tokens.css). */
export const EASE = {
  out: "cubic-bezier(0.22, 1, 0.36, 1)",
  inOut: "cubic-bezier(0.65, 0, 0.35, 1)",
  in: "cubic-bezier(0.55, 0, 1, 0.45)",
  spring: supportsLinear
    ? "linear(0, 0.039, 0.132, 0.254, 0.389, 0.524, 0.649, 0.75, 0.844, 0.919, 0.976, 1.017, 1.045, 1.06, 1.067, 1.067, 1.063, 1.056, 1.047, 1.038, 1.029, 1.022, 1.014, 1.009, 1.004, 1, 0.998, 0.997, 0.996, 0.995, 0.996, 0.996, 0.996, 0.997, 0.998, 0.998, 0.999, 0.999, 1, 1, 1)"
    : "cubic-bezier(0.34, 1.32, 0.64, 1)",
  springSoft: supportsLinear
    ? "linear(0, 0.032, 0.101, 0.201, 0.303, 0.416, 0.516, 0.616, 0.697, 0.774, 0.833, 0.885, 0.924, 0.956, 0.979, 0.996, 1.007, 1.015, 1.019, 1.021, 1.022, 1.021, 1.019, 1.017, 1.014, 1.012, 1.01, 1.008, 1.006, 1.005, 1.003, 1.002, 1.001, 1.001, 1, 1, 1)"
    : "cubic-bezier(0.3, 1.12, 0.6, 1)",
};

/** JS easing functions for per-frame interpolation. */
export const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);
export const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
export const easeOutBack = (t, s = 1.4) => 1 + (s + 1) * Math.pow(t - 1, 3) + s * Math.pow(t - 1, 2);

/** Animate safely: resolves even if WAAPI is missing or the animation is cancelled. */
export function animate(el, keyframes, options) {
  if (!el || !el.animate) return Promise.resolve();
  const opts = typeof options === "number" ? { duration: options } : options;
  if (reducedMotion() && !opts.allowReduced) {
    // Reduced motion: keep only opacity changes, quickly.
    const fades = keyframes.map((k) => ("opacity" in k ? { opacity: k.opacity } : {}));
    if (!fades.some((k) => "opacity" in k)) return Promise.resolve();
    keyframes = fades;
    opts.duration = Math.min(opts.duration ?? 200, 200);
    opts.delay = 0;
  }
  const a = el.animate(keyframes, opts);
  return new Promise((resolve) => {
    a.onfinish = resolve;
    a.oncancel = resolve;
  });
}

/* =======================================================================
   Odometer — rolls only the characters that change
   ======================================================================= */
export class Odometer {
  constructor(el) {
    this.el = el;
    this.value = null;
    this.slots = [];
  }

  /**
   * @param {string} value  e.g. "24:13" or "7"
   * @param {object} [opts] { direction: -1 (down) | 1 (up), instant }
   */
  set(value, opts = {}) {
    value = String(value);
    if (value === this.value) return;
    const prev = this.value;
    this.value = value;
    if (prev === null || prev.length !== value.length || opts.instant) {
      this.#build(value, prev !== null && !opts.instant);
      return;
    }
    const dir = opts.direction ?? (Number(value.replace(/\D/g, "")) < Number(prev.replace(/\D/g, "")) ? -1 : 1);
    [...value].forEach((ch, i) => {
      if (ch !== prev[i]) this.#roll(this.slots[i], ch, dir, i);
    });
  }

  #build(value, fade) {
    this.el.textContent = "";
    this.slots = [...value].map((ch) => {
      const slot = document.createElement("span");
      const isDigit = /\d/.test(ch);
      slot.className = isDigit ? "slot" : "slot slot--static";
      const sizer = document.createElement("span");
      sizer.className = "slot__sizer";
      sizer.textContent = isDigit ? "0" : ch;
      const val = document.createElement("span");
      val.className = "slot__val";
      val.textContent = ch;
      slot.append(sizer, val);
      this.el.append(slot);
      return { el: slot, current: val };
    });
    if (fade) animate(this.el, [{ opacity: 0, transform: "translateY(0.12em)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: EASE.out });
  }

  #roll(slot, ch, dir, index) {
    const old = slot.current;
    const next = document.createElement("span");
    next.className = "slot__val";
    next.textContent = ch;
    slot.el.append(next);
    slot.current = next;
    if (reducedMotion()) {
      old.remove();
      animate(next, [{ opacity: 0 }, { opacity: 1 }], { duration: 160, allowReduced: true });
      return;
    }
    // Countdown (dir -1): new digit drops in from above, old one falls away.
    const from = dir < 0 ? -100 : 100;
    // Higher-order digits lag a hair behind, like a real mechanism.
    const delay = Math.max(0, (this.slots.length - 1 - index) * 18);
    const kf = { duration: 520, delay, easing: EASE.springSoft, fill: "backwards" };
    next.animate([{ transform: `translateY(${from}%)`, opacity: 0 }, { transform: "translateY(0)", opacity: 1 }], kf);
    const out = old.animate(
      [{ transform: "translateY(0)", opacity: 1 }, { transform: `translateY(${-from * 0.9}%)`, opacity: 0 }],
      { duration: 340, delay, easing: EASE.inOut, fill: "forwards" },
    );
    const done = () => old.remove();
    out.onfinish = done;
    out.oncancel = done;
  }
}

/* =======================================================================
   Progress ring — driven per frame, with eased "sweeps" between values
   ======================================================================= */
export class Ring {
  constructor(progressEl, tipEl) {
    this.progressEl = progressEl;
    this.tipEl = tipEl;
    this.shown = -1;
    this.sweepState = null;
  }

  get animating() {
    return this.sweepState !== null;
  }

  /** Begin an eased transition from the currently shown value toward the live target. */
  sweep(duration = 760, from = this.shown) {
    if (reducedMotion()) duration = 200;
    this.sweepState = { from: Math.max(0, from), start: performance.now(), duration };
  }

  /** Render the ring for `target` (0..1). Call every frame while animating/running. */
  render(target, now = performance.now()) {
    let value = target;
    const sw = this.sweepState;
    if (sw) {
      const t = Math.min(1, (now - sw.start) / sw.duration);
      value = sw.from + (target - sw.from) * easeInOutCubic(t);
      if (t >= 1) this.sweepState = null;
    }
    if (Math.abs(value - this.shown) < 0.00005) return;
    this.shown = value;
    this.progressEl.style.strokeDashoffset = String(1 - value);
    this.progressEl.style.opacity = value < 0.004 ? "0" : "";
    this.tipEl.style.transform = `rotate(${value * 360}deg)`;
  }
}

/* =======================================================================
   Play ⇄ Pause morph: two quads interpolate between a split triangle
   and two rounded bars (works in every browser, unlike CSS `d`).
   ======================================================================= */
const SHAPES = {
  play: [
    [[8.5, 5.6], [13.5, 8.65], [13.5, 15.35], [8.5, 18.4]],
    [[13.5, 8.65], [19, 12], [19, 12], [13.5, 15.35]],
  ],
  pause: [
    [[7.5, 6], [10.5, 6], [10.5, 18], [7.5, 18]],
    [[13.5, 6], [16.5, 6], [16.5, 18], [13.5, 18]],
  ],
};
const toPath = (pts) => `M${pts.map((p) => `${p[0].toFixed(2)} ${p[1].toFixed(2)}`).join("L")}Z`;

export class PlayMorph {
  constructor(pathA, pathB) {
    this.paths = [pathA, pathB];
    this.state = "play";
    this.raf = 0;
    this.t = 0; // 0 = play, 1 = pause
  }

  set(state, animateIt = true) {
    if (state === this.state && !this.raf) return;
    this.state = state;
    const target = state === "pause" ? 1 : 0;
    cancelAnimationFrame(this.raf);
    if (!animateIt || reducedMotion()) {
      this.t = target;
      this.#draw(target);
      this.raf = 0;
      return;
    }
    const from = this.t;
    const start = performance.now();
    const dur = 420;
    const step = (now) => {
      const p = Math.min(1, (now - start) / dur);
      this.t = from + (target - from) * easeOutBack(p, 1.2);
      this.#draw(this.t);
      this.raf = p < 1 ? requestAnimationFrame(step) : 0;
    };
    this.raf = requestAnimationFrame(step);
  }

  #draw(t) {
    for (let i = 0; i < 2; i++) {
      const a = SHAPES.play[i];
      const b = SHAPES.pause[i];
      const pts = a.map((p, j) => [p[0] + (b[j][0] - p[0]) * t, p[1] + (b[j][1] - p[1]) * t]);
      this.paths[i].setAttribute("d", toPath(pts));
    }
  }
}

/* =======================================================================
   Segmented control (radiogroup) with a sliding pill
   ======================================================================= */
export function segmented(el, onChange) {
  const opts = $$(".segmented__opt", el);
  el.style.setProperty("--count", opts.length);
  const set = (value) => {
    const index = Math.max(0, opts.findIndex((o) => o.dataset.value === value || o.dataset.mode === value));
    el.style.setProperty("--index", index);
    opts.forEach((o, i) => {
      o.setAttribute("aria-checked", String(i === index));
      o.tabIndex = i === index ? 0 : -1;
    });
  };
  const valueOf = (o) => o.dataset.value ?? o.dataset.mode;
  opts.forEach((o, i) => {
    o.addEventListener("click", () => onChange(valueOf(o)));
    o.addEventListener("keydown", (e) => {
      const map = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 };
      let j = null;
      if (e.key in map) j = (i + map[e.key] + opts.length) % opts.length;
      else if (e.key === "Home") j = 0;
      else if (e.key === "End") j = opts.length - 1;
      if (j === null) return;
      e.preventDefault();
      e.stopPropagation();
      opts[j].focus();
      onChange(valueOf(opts[j]));
    });
  });
  return { set };
}

/* =======================================================================
   Toasts
   ======================================================================= */
export function toast(message, { icon = "check", action, onAction, duration = 3800 } = {}) {
  const host = $("#toasts");
  if (!host) return;
  while (host.children.length >= 2) host.firstElementChild.remove();
  const el = document.createElement("div");
  el.className = "toast";
  el.innerHTML = `<svg class="icon toast__icon" aria-hidden="true"><use href="#i-${icon}"/></svg><span></span>`;
  el.querySelector("span").textContent = message;
  let timer;
  const dismiss = () => {
    clearTimeout(timer);
    if (!el.isConnected || el.classList.contains("is-leaving")) return;
    el.classList.add("is-leaving");
    el.addEventListener("animationend", () => el.remove(), { once: true });
    setTimeout(() => el.remove(), 400);
  };
  if (action) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "toast__action";
    btn.textContent = action;
    btn.addEventListener("click", () => {
      onAction?.();
      dismiss();
    });
    el.append(btn);
  }
  host.append(el);
  if (duration > 0) timer = setTimeout(dismiss, duration);
  return dismiss;
}

/** Polite screen-reader announcement (used for phase changes only). */
export function announce(text) {
  const el = $("#announcer");
  if (!el) return;
  el.textContent = "";
  setTimeout(() => {
    el.textContent = text;
  }, 60);
}

/* =======================================================================
   Layers: settings sheet + modals. Focus trap, Esc, inert background,
   drag-to-dismiss with momentum on the phone bottom sheet.
   ======================================================================= */
const stack = [];
const FOCUSABLE =
  'button:not([disabled]):not([tabindex="-1"]), a[href], input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not(svg *)';

export const topLayer = () => stack[stack.length - 1] || null;

export class Layer {
  constructor(root, { draggable = false, onOpen, onClose } = {}) {
    this.root = root;
    this.panel = root.querySelector(".sheet, .modal");
    this.onOpen = onOpen;
    this.onClose = onClose;
    this.isOpen = false;
    this.returnFocus = null;
    $$("[data-close]", root).forEach((b) => b.addEventListener("click", () => this.close()));
    root.addEventListener("keydown", (e) => this.#onKey(e));
    if (draggable) this.#enableDrag();
  }

  open() {
    if (this.isOpen) return;
    this.isOpen = true;
    this.returnFocus = document.activeElement;
    stack.push(this);
    this.root.hidden = false;
    this.root.classList.remove("is-closing");
    this.panel.style.transform = "";
    this.#setInert(true);
    this.onOpen?.();
    // Two frames so the hidden→visible change commits before the transition.
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        this.root.classList.add("is-open");
        // Focus the dialog itself so screen readers announce it; Tab moves inside.
        this.panel.focus({ preventScroll: true });
      }),
    );
  }

  close() {
    if (!this.isOpen) return;
    this.isOpen = false;
    stack.splice(stack.indexOf(this), 1);
    this.root.classList.remove("is-open");
    this.root.classList.add("is-closing");
    this.#setInert(false);
    const finish = () => {
      if (this.isOpen) return;
      this.root.hidden = true;
      this.root.classList.remove("is-closing");
      this.panel.style.transform = "";
      this.panel.style.transition = "";
    };
    const onEnd = (e) => {
      if (e.target !== this.panel || e.propertyName !== "transform") return;
      clearTimeout(t);
      this.panel.removeEventListener("transitionend", onEnd);
      finish();
    };
    const t = setTimeout(() => {
      this.panel.removeEventListener("transitionend", onEnd);
      finish();
    }, reducedMotion() ? 220 : 600);
    this.panel.addEventListener("transitionend", onEnd);
    this.onClose?.();
    const target = this.returnFocus;
    if (target && document.contains(target)) target.focus({ preventScroll: true });
  }

  toggle() {
    this.isOpen ? this.close() : this.open();
  }

  #setInert(on) {
    for (const el of document.body.children) {
      if (el === this.root || el.id === "toasts" || el.id === "announcer" || el.tagName === "SCRIPT") continue;
      if (on && !el.inert) {
        el.inert = true;
        el.dataset.inertBy = "layer";
      } else if (!on && stack.length === 0 && el.dataset.inertBy === "layer") {
        el.inert = false;
        delete el.dataset.inertBy;
      }
    }
  }

  #onKey(e) {
    if (e.key === "Escape") {
      e.stopPropagation();
      this.close();
      return;
    }
    if (e.key !== "Tab") return;
    const items = $$(FOCUSABLE, this.panel).filter((el) => el.getClientRects().length > 0 || el === document.activeElement);
    if (!items.length) return;
    const first = items[0];
    const last = items[items.length - 1];
    if (e.shiftKey && (document.activeElement === first || document.activeElement === this.panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }

  #enableDrag() {
    const grab = $(".sheet__grab", this.root);
    const isBottomSheet = window.matchMedia("(max-width: 767px)");
    let startY = 0;
    let lastY = 0;
    let lastT = 0;
    let velocity = 0;
    let dragging = false;
    let pointerId = null;

    const onDown = (e) => {
      if (!isBottomSheet.matches || e.button > 0 || e.target.closest("button")) return;
      dragging = true;
      pointerId = e.pointerId;
      startY = lastY = e.clientY;
      lastT = performance.now();
      velocity = 0;
      grab.setPointerCapture(pointerId);
      this.panel.classList.add("is-dragging");
    };
    const onMove = (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      const now = performance.now();
      const dt = Math.max(1, now - lastT);
      velocity = 0.8 * ((e.clientY - lastY) / dt) + 0.2 * velocity;
      lastY = e.clientY;
      lastT = now;
      let dy = e.clientY - startY;
      if (dy < 0) dy = -Math.pow(-dy, 0.7); // rubber-band upward
      this.panel.style.transform = `translateY(${dy}px)`;
      const progress = Math.max(0, dy) / this.panel.offsetHeight;
      $(".layer__scrim", this.root).style.opacity = String(1 - progress * 0.9);
    };
    const onUp = (e) => {
      if (!dragging || e.pointerId !== pointerId) return;
      dragging = false;
      this.panel.classList.remove("is-dragging");
      const scrim = $(".layer__scrim", this.root);
      scrim.style.opacity = "";
      const dy = e.clientY - startY;
      const height = this.panel.offsetHeight;
      if (dy > height * 0.28 || (velocity > 0.55 && dy > 12)) {
        // Fling: finish the travel at a speed that matches the gesture.
        const remaining = height - dy;
        const ms = Math.max(160, Math.min(380, remaining / Math.max(velocity, 0.8)));
        this.panel.style.transition = `transform ${ms}ms cubic-bezier(0.2, 0.7, 0.3, 1)`;
        this.panel.style.transform = `translateY(102%)`;
        this.close();
      } else {
        this.panel.style.transition = `transform 520ms ${EASE.spring}`;
        this.panel.style.transform = "";
        setTimeout(() => (this.panel.style.transition = ""), 540);
      }
    };
    grab.addEventListener("pointerdown", onDown);
    grab.addEventListener("pointermove", onMove);
    grab.addEventListener("pointerup", onUp);
    grab.addEventListener("pointercancel", onUp);
  }
}

/* =======================================================================
   Tactile feedback
   ======================================================================= */

/** Soft ripple from the press point. */
export function ripple(el) {
  el.addEventListener("pointerdown", (e) => {
    if (reducedMotion()) return;
    const r = el.getBoundingClientRect();
    const size = Math.max(r.width, r.height) * 2.2;
    const dot = document.createElement("span");
    dot.className = "ripple";
    dot.style.width = dot.style.height = `${size}px`;
    dot.style.left = `${e.clientX - r.left - size / 2}px`;
    dot.style.top = `${e.clientY - r.top - size / 2}px`;
    el.append(dot);
    animate(dot, [{ transform: "scale(0)", opacity: 0.28 }, { transform: "scale(1)", opacity: 0 }], {
      duration: 680,
      easing: EASE.out,
    }).then(() => dot.remove());
  });
}

/** Gentle magnetic pull toward the cursor (pointer devices only). */
export function magnetic(el, strength = 0.22, max = 7) {
  if (!window.matchMedia("(hover: hover) and (pointer: fine)").matches) return;
  const zone = el.parentElement;
  let raf = 0;
  zone.addEventListener("pointermove", (e) => {
    if (reducedMotion() || e.pointerType !== "mouse") return;
    cancelAnimationFrame(raf);
    raf = requestAnimationFrame(() => {
      const r = el.getBoundingClientRect();
      const dx = e.clientX - (r.left + r.width / 2);
      const dy = e.clientY - (r.top + r.height / 2);
      const dist = Math.hypot(dx, dy);
      const reach = r.width * 1.1;
      if (dist > reach) {
        el.style.setProperty("--mx", "0px");
        el.style.setProperty("--my", "0px");
        return;
      }
      const f = Math.min(1, (reach - dist) / reach + 0.35);
      el.style.setProperty("--mx", `${Math.max(-max, Math.min(max, dx * strength * f))}px`);
      el.style.setProperty("--my", `${Math.max(-max, Math.min(max, dy * strength * f))}px`);
    });
  });
  zone.addEventListener("pointerleave", () => {
    cancelAnimationFrame(raf);
    el.style.setProperty("--mx", "0px");
    el.style.setProperty("--my", "0px");
  });
}

/** Tween a number in an element's text. */
export function countUp(el, to, { duration = 900, format = (v) => String(Math.round(v)), from = 0 } = {}) {
  if (reducedMotion() || duration <= 0) {
    el.textContent = format(to);
    return;
  }
  const start = performance.now();
  const step = (now) => {
    const t = Math.min(1, (now - start) / duration);
    el.textContent = format(from + (to - from) * easeOutCubic(t));
    if (t < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

/** Small icon helper for rendered markup. */
export const icon = (name, cls = "icon") => `<svg class="${cls}" aria-hidden="true"><use href="#i-${name}"/></svg>`;

/** Escape text for safe innerHTML templating. */
export const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
