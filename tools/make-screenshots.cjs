/** Renders the manifest screenshots (install UI). Run with the app served on :8080. */
const path = require("path");
const { chromium } = require("playwright");
const BASE = process.argv[2] || "http://localhost:8080/";
const OUT = path.join(__dirname, "..", "assets", "screenshots");
(async () => {
  const b = await chromium.launch();
  for (const [name, w, h, dpr] of [["narrow", 390, 844, 2], ["wide", 1280, 800, 1]]) {
    const ctx = await b.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: dpr, colorScheme: "light" });
    await ctx.addInitScript(() => {
      const now = Date.now();
      const key = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
      const days = {}; [4, 6, 3, 7, 5].forEach((c, i) => (days[key(now - i * 864e5)] = { count: c, ms: c * 15e5 }));
      const sessions = [0, 1, 2].map((i) => ({ id: "s" + i, start: now - (i + 1) * 36e5 - 15e5, end: now - (i + 1) * 36e5, duration: 15e5, task: ["Draft the launch plan", "Read research notes", "Inbox zero"][i] }));
      localStorage.setItem("pomodoro-timer/v1", JSON.stringify({ version: 1, settings: { sound: false }, timer: { mode: "focus", status: "paused", duration: 15e5, remaining: 1032000, cycle: 2, task: "Draft the launch plan" }, sessions, days }));
    });
    const page = await ctx.newPage();
    await page.goto(BASE);
    await page.waitForTimeout(2600);
    await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 84 });
    await ctx.close();
  }
  await b.close();
})();
