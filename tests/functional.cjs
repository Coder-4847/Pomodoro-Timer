/**
 * Functional checks in real Chromium. Usage: node tests/functional.cjs [baseUrl]
 * Uses Playwright's clock to fake time (sleep, throttling, midnight).
 */
const fs = require("fs");
const os = require("os");
const path = require("path");
const { chromium } = require("playwright");

const BASE = process.argv[2] || "http://localhost:8080/";
const KEY = "pomodoro-timer/v1";
let failures = 0;
const results = [];

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

async function test(name, fn, ctxOpts = {}) {
  const browser = test.browser;
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, ...ctxOpts });
  const page = await ctx.newPage();
  const errors = [];
  page.on("console", (m) => (m.type() === "error" || m.type() === "warning") && errors.push(m.text()));
  page.on("pageerror", (e) => errors.push(e.message));
  try {
    await Promise.race([fn(page, ctx), new Promise((_, rej) => setTimeout(() => rej(new Error("timed out")), 45000))]);
    assert(errors.length === 0, `console errors: ${errors.join(" | ")}`);
    results.push(`  ✓ ${name}`);
  } catch (e) {
    failures++;
    results.push(`  ✗ ${name}\n      ${e.message.split("\n")[0]}`);
  }
  await ctx.close();
}

const state = (page) => page.evaluate((k) => JSON.parse(localStorage.getItem(k)), KEY);
const digits = (page) => page.$eval("#digits", (el) => [...el.querySelectorAll(".slot")].map((s) => s.lastElementChild.textContent).join(""));
const settle = (page, ms = 900) => page.waitForTimeout(ms);
/** Jump the fake clock (firing due timers once), then let a few frames run. */
const tick = async (page, ms) => {
  await page.clock.fastForward(ms);
  await page.clock.runFor(100);
};
const seed = (ctx, data) =>
  ctx.addInitScript(([k, d]) => {
    if (!sessionStorage.getItem("seeded")) {
      localStorage.setItem(k, JSON.stringify(d));
      sessionStorage.setItem("seeded", "1");
    }
  }, [KEY, data]);
const dayKey = (ts) => {
  const d = new Date(ts);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

(async () => {
  test.browser = await chromium.launch();

  await test("loads with default 25:00 focus, no errors", async (page) => {
    await page.goto(BASE);
    await settle(page, 1500);
    assert((await digits(page)) === "25:00", `digits ${await digits(page)}`);
    assert((await page.getAttribute("html", "data-mode")) === "focus", "mode attr");
    assert(await page.$eval("html", (h) => h.classList.contains("is-loaded")), "is-loaded");
  });

  await test("start / pause / resume keeps exact time (mock clock)", async (page) => {
    await page.clock.install();
    await page.goto(BASE);
    await settle(page, 1000);
    await page.click("#btn-play");
    await tick(page, 61_000);
    await settle(page, 200);
    assert((await digits(page)) === "23:59", `after 61s: ${await digits(page)}`);
    await page.click("#btn-play"); // pause
    let s = await state(page);
    assert(s.timer.status === "paused", "paused");
    assert(Math.abs(s.timer.remaining - (25 * 60000 - 61000)) < 1500, `remaining ${s.timer.remaining}`);
    await tick(page, 120_000); // time passes while paused
    await settle(page, 200);
    assert((await digits(page)) === "23:59", `paused digits moved: ${await digits(page)}`);
    await page.click("#btn-play"); // resume
    await tick(page, 60_000);
    await settle(page, 200);
    assert((await digits(page)) === "22:59", `after resume: ${await digits(page)}`);
  });

  await test("laptop sleep: wall clock jump completes phase correctly", async (page) => {
    await page.clock.install();
    await page.goto(BASE);
    await settle(page, 1000);
    await page.click("#btn-play");
    await tick(page, 5_000);
    // Jump the system clock forward 40 minutes without firing timers (sleep).
    const now = await page.evaluate(() => Date.now());
    await page.clock.setSystemTime(now + 40 * 60000);
    await tick(page, 1_000);
    await settle(page, 500);
    const s = await state(page);
    assert(s.days[dayKey(now + 40 * 60000)]?.count === 1 || s.days[dayKey(now)]?.count === 1, "session counted");
    assert(s.timer.mode === "short", `mode ${s.timer.mode}`);
    assert(s.timer.status === "idle", "no auto-start after long absence");
    assert(s.sessions[0].end - s.sessions[0].start === 25 * 60000, "session end = original endAt");
    assert(await page.isVisible("#away-note"), "away note visible");
  });

  await test("live completion: focus → short break, counter & dots update", async (page) => {
    await page.clock.install();
    await page.goto(BASE);
    await settle(page, 1000);
    await page.fill("#task-input", "Write tests");
    await page.click("#btn-play");
    await tick(page, 25 * 60000 + 500);
    await settle(page, 300);
    await tick(page, 2000);
    await settle(page, 600);
    const s = await state(page);
    assert(s.sessions.length === 1 && s.sessions[0].task === "Write tests", "session with task label saved");
    assert(s.timer.mode === "short" && s.timer.cycle === 1, `mode ${s.timer.mode} cycle ${s.timer.cycle}`);
    assert((await page.getAttribute("html", "data-mode")) === "short", "palette switched");
    assert((await page.textContent("#today-count-sr")) === "1", "today counter = 1");
    assert((await page.$$(".dot.is-filled")).length === 1, "one dot filled");
    assert(!(await page.isVisible("#away-note")), "no away note for live completion");
  });

  await test("auto-start breaks starts next phase from the true end time", async (page, ctx) => {
    await page.clock.install();
    await seed(ctx, { version: 1, settings: { autoStartBreaks: true } });
    await page.goto(BASE);
    await settle(page, 1000);
    await page.click("#btn-play");
    await tick(page, 25 * 60000 + 3000);
    await settle(page, 300);
    const s = await state(page);
    assert(s.timer.mode === "short" && s.timer.status === "running", `${s.timer.mode}/${s.timer.status}`);
    assert(s.timer.endAt - s.sessions[0].end === 5 * 60000, "break anchored to focus end");
  });

  await test("skip does not count; long break after 4 sessions; long break resets cycle", async (page, ctx) => {
    await seed(ctx, { version: 1, timer: { mode: "focus", cycle: 3 } });
    await page.goto(BASE);
    await settle(page, 1000);
    await page.click("#btn-skip");
    let s = await state(page);
    assert(s.sessions.length === 0, "skip counted a session");
    assert(s.timer.mode === "short", `after skip: ${s.timer.mode}`);
    // Complete a focus with cycle 3 → long break
    await page.evaluate((k) => {
      const d = JSON.parse(localStorage.getItem(k));
      d.timer = { ...d.timer, mode: "focus", status: "running", duration: 1500000, remaining: 1500000, endAt: Date.now() + 1500, startedAt: Date.now() - 1498500, cycle: 3 };
      localStorage.setItem(k, JSON.stringify(d));
    }, KEY);
    await page.reload();
    await settle(page, 2600);
    s = await state(page);
    assert(s.timer.mode === "long" && s.timer.cycle === 4, `expected long/4 got ${s.timer.mode}/${s.timer.cycle}`);
    assert((await page.$$(".dot.is-filled")).length === 4, "4 dots");
    await page.click("#btn-skip");
    s = await state(page);
    assert(s.timer.mode === "focus" && s.timer.cycle === 0, "cycle reset after long break");
  });

  await test("refresh restores a running timer", async (page) => {
    await page.goto(BASE);
    await settle(page, 1000);
    await page.click("#btn-play");
    await page.waitForTimeout(2200);
    await page.reload();
    await settle(page, 1200);
    const s = await state(page);
    assert(s.timer.status === "running", "still running after reload");
    const d = await digits(page);
    assert(d === "24:57" || d === "24:56" || d === "24:58", `digits after reload ${d}`);
    assert((await page.title()).includes("· Focus"), `title ${await page.title()}`);
  });

  await test("finished while the tab was closed → away note, counted once", async (page, ctx) => {
    const now = Date.now();
    await seed(ctx, {
      version: 1,
      timer: { mode: "focus", status: "running", duration: 1500000, remaining: 1500000, endAt: now - 10 * 60000, startedAt: now - 35 * 60000, cycle: 0, task: "Deep work" },
    });
    await page.goto(BASE);
    await settle(page, 1500);
    assert(await page.isVisible("#away-note"), "away note");
    const s = await state(page);
    assert(s.sessions.length === 1 && s.sessions[0].end === now - 10 * 60000, "session recorded at its real end");
    assert(s.timer.mode === "short" && s.timer.status === "idle", "idle short break");
    await page.reload();
    await settle(page, 1000);
    assert((await state(page)).sessions.length === 1, "not double counted on reload");
  });

  await test("midnight rollover resets today's count", async (page, ctx) => {
    const d = new Date();
    const lateNight = new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 30).getTime();
    await page.clock.install({ time: lateNight });
    await seed(ctx, { version: 1, days: { [dayKey(lateNight)]: { count: 3, ms: 4500000 } } });
    await page.goto(BASE);
    await settle(page, 1000);
    assert((await page.textContent("#today-count-sr")) === "3", "3 before midnight");
    await tick(page, 45_000);
    await settle(page, 300);
    assert((await page.textContent("#today-count-sr")) === "0", `after midnight: ${await page.textContent("#today-count-sr")}`);
    const streak = await page.textContent("#today-streak");
    assert(streak === "1 day", `streak carries from yesterday: ${streak}`);
  });

  await test("reload in a break restores label, segmented control and palette", async (page, ctx) => {
    await seed(ctx, { version: 1, timer: { mode: "long", status: "idle", duration: 900000, remaining: 900000 } });
    await page.goto(BASE);
    await settle(page, 1200);
    assert((await page.textContent("#mode-label")) === "Long Break", `label ${await page.textContent("#mode-label")}`);
    assert((await page.getAttribute('#mode-switch [data-mode="long"]', "aria-checked")) === "true", "segmented");
    assert((await page.getAttribute("html", "data-mode")) === "long", "palette");
  });

  await test("mode switch via segmented control + undo", async (page) => {
    await page.goto(BASE);
    await settle(page, 1000);
    await page.click('#mode-switch [data-mode="long"]');
    await settle(page, 900);
    assert((await page.getAttribute("html", "data-mode")) === "long", "long mode");
    assert((await digits(page)) === "15:00", `digits ${await digits(page)}`);
    await page.click('#mode-switch [data-mode="focus"]');
    await page.click("#btn-play");
    await page.waitForTimeout(1500);
    await page.click('#mode-switch [data-mode="short"]');
    await settle(page, 300);
    assert(await page.isVisible(".toast__action"), "undo offered");
    await page.click(".toast__action");
    await settle(page, 300);
    const s = await state(page);
    assert(s.timer.mode === "focus" && s.timer.status === "running", "undo restored running focus");
  });

  await test("keyboard shortcuts", async (page) => {
    await page.goto(BASE);
    await settle(page, 1200);
    await page.keyboard.press("Space");
    assert((await state(page)).timer.status === "running", "space starts");
    await page.keyboard.press("Space");
    assert((await state(page)).timer.status === "paused", "space pauses");
    await page.keyboard.press("r");
    assert((await state(page)).timer.status === "idle", "r resets");
    await page.keyboard.press("2");
    assert((await state(page)).timer.mode === "short", "2 → short");
    await page.keyboard.press("3");
    assert((await state(page)).timer.mode === "long", "3 → long");
    await page.keyboard.press("1");
    await page.keyboard.press("s");
    assert((await state(page)).timer.mode === "short", "s skips");
    await page.keyboard.press(",");
    await settle(page, 600);
    assert(await page.isVisible("#settings-layer .sheet"), "settings open");
    await page.keyboard.press("Space"); // must not toggle the timer while a sheet is open
    await page.keyboard.press("Escape");
    await settle(page, 700);
    assert(await page.isHidden("#settings-layer"), "esc closes settings");
    await page.keyboard.press("?");
    await settle(page, 500);
    assert(await page.isVisible("#shortcuts-layer .modal"), "cheat sheet open");
    await page.keyboard.press("Escape");
    await settle(page, 600);
    await page.keyboard.press("z");
    await settle(page, 700);
    assert(await page.$eval("html", (h) => h.classList.contains("is-zen")), "zen on");
    await page.keyboard.press("Escape");
    await settle(page, 700);
    assert(!(await page.$eval("html", (h) => h.classList.contains("is-zen"))), "zen off");
    await page.keyboard.press("t");
    await settle(page, 900);
    assert(await page.isVisible("#view-stats"), "t opens stats");
    await page.keyboard.press("Escape");
    await settle(page, 900);
    assert(await page.isHidden("#view-stats"), "esc back to timer");
  });

  await test("focus trap keeps Tab inside the settings sheet", async (page) => {
    await page.goto(BASE);
    await settle(page, 1000);
    await page.click("#btn-settings");
    await settle(page, 700);
    for (let i = 0; i < 60; i++) {
      await page.keyboard.press("Tab");
      const inside = await page.evaluate(() => !!document.activeElement.closest("#settings-layer"));
      assert(inside, `focus escaped at tab ${i}`);
    }
  });

  await test("settings persist across reload; duration applies to idle timer", async (page) => {
    await page.goto(BASE);
    await settle(page, 1000);
    await page.click("#btn-settings");
    await settle(page, 700);
    const plus = '.stepper[data-path="durations.focus"] [data-step="1"]';
    await page.click(plus);
    await page.click(plus);
    await page.click('.switch[data-path="autoStartBreaks"]');
    await page.click('#theme-switch [data-value="dark"]');
    await settle(page, 300);
    assert((await page.getAttribute("html", "data-theme")) === "dark", "dark theme applied");
    await page.keyboard.press("Escape");
    await settle(page, 600);
    assert((await digits(page)) === "27:00", `idle timer updated: ${await digits(page)}`);
    await page.reload();
    await settle(page, 1000);
    const s = await state(page);
    assert(s.settings.durations.focus === 27 && s.settings.autoStartBreaks && s.settings.theme === "dark", "persisted");
    assert((await page.getAttribute("html", "data-theme")) === "dark", "theme before paint");
  });

  await test("export and import JSON backup", async (page) => {
    await page.goto(BASE);
    await settle(page, 1000);
    await page.click("#btn-settings");
    await settle(page, 700);
    const [download] = await Promise.all([page.waitForEvent("download"), page.click("#btn-export")]);
    const file = path.join(os.tmpdir(), `pomo-export-${Date.now()}.json`);
    await download.saveAs(file);
    const exported = JSON.parse(fs.readFileSync(file, "utf8"));
    assert(exported.app === "pomodoro-timer" && exported.settings, "export shape");
    exported.settings.dailyGoal = 5;
    exported.days = { "2026-01-02": { count: 4, ms: 6000000 } };
    exported.sessions = [{ id: "x", start: 1, end: 1500001, duration: 1500000, task: "Imported" }];
    fs.writeFileSync(file, JSON.stringify(exported));
    await page.setInputFiles("#import-file", file);
    await settle(page, 500);
    const s = await state(page);
    assert(s.settings.dailyGoal === 5 && s.sessions[0].task === "Imported", "import applied");
    const bad = path.join(os.tmpdir(), "bad.json");
    fs.writeFileSync(bad, "{nope");
    await page.setInputFiles("#import-file", bad);
    await settle(page, 400);
    assert((await page.textContent("#toasts")).includes("isn't a valid"), "bad file rejected gracefully");
  });

  await test("stats view renders chart with 7 bars-columns and recent list", async (page, ctx) => {
    await seed(ctx, { version: 1, days: { [dayKey(Date.now())]: { count: 2, ms: 3000000 } }, sessions: [{ id: "a", start: Date.now() - 1600000, end: Date.now() - 100000, duration: 1500000, task: "<b>xss</b>" }] });
    await page.goto(BASE + "#stats");
    await settle(page, 1800);
    assert((await page.$$(".chart__col")).length === 7, "7 columns");
    const txt = await page.textContent(".tile--recent");
    assert(txt.includes("<b>xss</b>"), "task text escaped, not injected");
    await page.click("#btn-stats-back");
    await settle(page, 800);
    assert(await page.isVisible("#main"), "back to timer");
  });

  await test("works with blocked localStorage", async (page, ctx) => {
    await ctx.addInitScript(() => {
      Object.defineProperty(window, "localStorage", { get() { throw new DOMException("blocked", "SecurityError"); } });
    });
    await page.goto(BASE);
    await settle(page, 1200);
    await page.click("#btn-play");
    await page.waitForTimeout(1200);
    assert((await digits(page)) !== "25:00", "timer runs");
  });

  await test("reduced motion: fully functional", async (page) => {
    await page.goto(BASE);
    await settle(page, 800);
    await page.click("#btn-play");
    await page.click('#mode-switch [data-mode="short"]');
    await page.click("#btn-stats");
    await settle(page, 600);
    assert(await page.isVisible("#view-stats"), "stats");
  }, { reducedMotion: "reduce" });

  await test("service worker caches shell; app loads offline", async (page, ctx) => {
    await page.goto(BASE);
    await page.evaluate(() => navigator.serviceWorker.ready);
    await page.reload(); // now controlled
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null);
    await settle(page, 800);
    await ctx.setOffline(true);
    await page.reload();
    await settle(page, 1500);
    assert((await digits(page)) === "25:00", "renders offline");
    const font = await page.evaluate(() => document.fonts.check('300 48px "Inter Var"'));
    assert(font, "bundled font available offline");
    await ctx.setOffline(false);
  });

  await test("manifest is valid and icons resolve", async (page) => {
    const res = await page.goto(BASE + "manifest.webmanifest");
    const m = await res.json();
    assert(m.start_url === "./" && m.display === "standalone", "manifest fields");
    for (const icon of m.icons) {
      const r = await page.request.get(new URL(icon.src, BASE + "manifest.webmanifest").href);
      assert(r.ok(), `icon ${icon.src} ${r.status()}`);
    }
  });

  await test.browser.close();
  console.log(results.join("\n"));
  console.log(failures ? `\n${failures} failing` : "\nall passing");
  process.exit(failures ? 1 : 0);
})();
