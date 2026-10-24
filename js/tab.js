/**
 * tab.js — dynamic document title ("24:13 · Focus") and a favicon that
 * draws the live progress ring onto a small canvas.
 */

const BASE_TITLE = "Pomodoro Timer";
const SIZE = 64;

export class TabIndicator {
  constructor() {
    this.staticLinks = [...document.querySelectorAll('link[rel~="icon"]')];
    this.canvas = document.createElement("canvas");
    this.canvas.width = this.canvas.height = SIZE;
    this.ctx = this.canvas.getContext("2d");
    this.dynamicLink = null;
    this.lastKey = "";
    this.lastTitle = "";
  }

  update({ status, label, time, progress, away }) {
    let title = BASE_TITLE;
    if (status === "running") title = `${time} · ${label}`;
    else if (status === "paused") title = `Paused · ${time} · ${label}`;
    else if (away) title = `Done · ${BASE_TITLE}`;
    if (title !== this.lastTitle) {
      document.title = title;
      this.lastTitle = title;
    }
    this.#favicon(status, progress);
  }

  #favicon(status, progress) {
    if (!this.ctx) return;
    if (status === "idle") {
      if (this.dynamicLink) {
        this.dynamicLink.remove();
        this.dynamicLink = null;
        this.staticLinks.forEach((l) => document.head.append(l));
        this.lastKey = "";
      }
      return;
    }
    const cs = getComputedStyle(document.documentElement);
    const ringColor = cs.getPropertyValue("--ring-b").trim() || "#5c83ae";
    const soft = cs.getPropertyValue("--accent-soft").trim() || "#d5e2f1";
    const step = Math.round(progress * 96); // ~96 visual steps is plenty at 16px
    const key = `${status}|${step}|${ringColor}`;
    if (key === this.lastKey) return;
    this.lastKey = key;

    const c = this.ctx;
    const mid = SIZE / 2;
    const r = 23;
    c.clearRect(0, 0, SIZE, SIZE);
    c.lineCap = "round";
    c.lineWidth = 10;
    c.strokeStyle = soft;
    c.beginPath();
    c.arc(mid, mid, r, 0, Math.PI * 2);
    c.stroke();
    c.globalAlpha = status === "paused" ? 0.55 : 1;
    c.strokeStyle = ringColor;
    c.beginPath();
    const p = Math.max(0.02, progress);
    c.arc(mid, mid, r, -Math.PI / 2, -Math.PI / 2 + p * Math.PI * 2);
    c.stroke();
    c.globalAlpha = 1;

    let url;
    try {
      url = this.canvas.toDataURL("image/png");
    } catch {
      return;
    }
    if (!this.dynamicLink) {
      this.staticLinks.forEach((l) => l.remove());
      this.dynamicLink = document.createElement("link");
      this.dynamicLink.rel = "icon";
      this.dynamicLink.type = "image/png";
      document.head.append(this.dynamicLink);
    }
    this.dynamicLink.href = url;
  }
}
