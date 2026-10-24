/**
 * Visual sweep: every viewport × theme × mode. Collects console errors.
 * Usage: node tests/screenshots.cjs [baseUrl] [outDir] [--quick]
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:8080/";
const OUT = process.argv[3] || path.join(__dirname, "..", ".screenshots");
const QUICK = process.argv.includes("--quick");
const VIEWPORTS = [
  [360, 640], [390, 844], [430, 932], [768, 1024], [1024, 768], [1280, 800], [1440, 900], [1920, 1080],
];
const THEMES = ["light", "dark"];
const MODES = ["focus", "short", "long"];

function seed(theme, mode) {
  const now = Date.now();
  const days = {};
  const sessions = [];
  for (let i = 0; i < 9; i++) {
    const d = new Date(now - i * 86400000);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    const count = [3, 5, 2, 7, 4, 0, 6, 8, 1][i];
    if (count) days[key] = { count, ms: count * 25 * 60000 };
    for (let j = 0; j < Math.min(count, 2); j++) {
      const end = now - i * 86400000 - j * 3600000;
      sessions.push({ id: `s${i}${j}`, start: end - 1500000, end, duration: 1500000, task: ["Write the quarterly report", "Design review", ""][(i + j) % 3] });
    }
  }
  const dur = { focus: 25, short: 5, long: 15 }[mode] * 60000;
  return {
    version: 1,
    settings: { theme, durations: { focus: 25, short: 5, long: 15 }, longInterval: 4, dailyGoal: 8, sound: false },
    timer: { mode, status: "paused", duration: dur, remaining: Math.round(dur * 0.62), endAt: null, startedAt: now - 60000, cycle: 2, task: "Write the quarterly report" },
    sessions: sessions.sort((a, b) => a.end - b.end),
    days,
    meta: {},
  };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const browser = await chromium.launch();
  const errors = [];
  const vps = QUICK ? [[390, 844], [1440, 900]] : VIEWPORTS;
  for (const [w, h] of vps) {
    for (const theme of THEMES) {
      for (const mode of QUICK ? ["focus"] : MODES) {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 1, colorScheme: theme, hasTouch: w < 1000, isMobile: w < 700 });
        await ctx.addInitScript((data) => {
          if (!sessionStorage.getItem("seeded")) {
            localStorage.setItem("pomodoro-timer/v1", JSON.stringify(data));
            sessionStorage.setItem("seeded", "1");
          }
        }, seed(theme, mode));
        const page = await ctx.newPage();
        page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${w}x${h} ${theme} ${mode}: ${m.text()}`); });
        page.on("pageerror", (e) => errors.push(`${w}x${h} ${theme} ${mode}: PAGEERROR ${e.message}`));
        await page.goto(BASE, { waitUntil: "load" });
        await page.waitForTimeout(2600);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
        if (overflow) errors.push(`${w}x${h} ${theme} ${mode}: horizontal overflow`);
        await page.screenshot({ path: path.join(OUT, `${w}x${h}-${theme}-${mode}.png`) });
        if (mode === "focus") {
          await page.click("#btn-stats");
          await page.waitForTimeout(1800);
          await page.screenshot({ path: path.join(OUT, `${w}x${h}-${theme}-stats.png`), fullPage: true });
          await page.click("#btn-stats-back");
          await page.waitForTimeout(700);
          await page.click("#btn-settings");
          await page.waitForTimeout(900);
          await page.screenshot({ path: path.join(OUT, `${w}x${h}-${theme}-settings.png`) });
        }
        await ctx.close();
      }
    }
  }
  await browser.close();
  console.log(errors.length ? errors.join("\n") : "no console errors");
})();
