# MEMORY.md: project handoff

A complete record of what this project is, how it is built, the decisions behind it, how it was verified, and where it stands. Read this first when picking the project up in a new session.

_Last updated: 2026-10-24_

---

## 1. What this is

**Pomodoro Timer** is a premium-feeling Pomodoro web app: plain HTML, CSS and ES-module JavaScript, with no framework, bundler, build step, runtime dependencies or CDN. It is an installable, offline-capable PWA deployed to GitHub Pages.

- Repo: `https://github.com/Coder-4847/Pomodoro-Timer` (capitalised; Pages subpath is `/Pomodoro-Timer/`)
- Expected live URL: **https://coder-4847.github.io/Pomodoro-Timer/**
- Branches: `main` (deploys) and `claude/sharp-euler-wlq1ft` (the session's working branch); both carry the same commits.
- Owner email used for attribution: bansalettan@gmail.com

### The brief, summarised
The bar was "award-level design and animation polish": calm, airy, faded pastels; restraint over flash; every state change animated; it must work on phone, iPad and laptop, be installable and work offline, be accessible, and score 95+ on Lighthouse.

---

## 2. Status

| Area | State |
| --- | --- |
| App features (all of section 3 of the brief) | ✅ Done |
| Visual design (3 modes × light/dark) | ✅ Done, reviewed at 8 viewports |
| Animations / motion system | ✅ Done |
| PWA (manifest, SW, icons, offline) | ✅ Done, offline verified in tests |
| Functional tests | ✅ 20/20 passing (`tests/functional.cjs`) |
| Visual sweep | ✅ 80 screenshots, no console errors, no horizontal overflow |
| Lighthouse (local, mobile throttling, no gzip) | Perf **95**, A11y **100**, Best Practices **100**, SEO **100** |
| Pushed to GitHub | ✅ `main` and `claude/sharp-euler-wlq1ft` |
| GitHub Pages deploy | ✅ Workflow run #1 succeeded ("Reported success!"), environment URL https://coder-4847.github.io/Pomodoro-Timer/ |
| Live check from inside the session | ⚠️ Not possible: the cloud container's network policy blocks `*.github.io`. Do the 2-minute check in §11 from a real browser. |

---

## 3. Architecture

```
index.html              Shell, inline SVG icon sprite, dialogs, inline boot script
manifest.webmanifest    PWA manifest (icons, maskable, screenshots, shortcut)
sw.js                   Service worker
css/tokens.css          Tokens + the six colour worlds (@property registered colours)
css/base.css            Reset, drifting backdrop, layout shell, responsive breakpoints
css/components.css      Every component
css/animations.css      Keyframes, load choreography, view transitions, reduced motion
js/main.js              Orchestrator (loop, render, choreography, keys, zen, views, SW)
js/timer.js             Timer engine (EventTarget)
js/state.js             Schema, defaults, sanitize/migrate, store
js/storage.js           localStorage wrapper with in-memory fallback + cross-tab events
js/ui.js                Primitives: Odometer, Ring, PlayMorph, segmented, Layer, toast…
js/fx.js                Particle bursts / ring waves
js/stats.js             Pure stats helpers + Today panel + Statistics view (SVG chart)
js/settings.js          Schema-rendered settings sheet, export/import/reset
js/notify.js            Notifications, vibration, wake lock, platform detection
js/audio.js             Web Audio synthesised chimes
js/tab.js               Dynamic <title> + canvas favicon
assets/fonts/           inter-var.woff2 (Inter variable, latin, 48 KB) + OFL.txt
assets/icons/           favicon.svg/32, icon-192/512, maskable-192/512, apple-touch, badge-72
assets/screenshots/     narrow.jpg (780×1688), wide.jpg (1280×800) for install UI
tests/functional.cjs    20 Playwright checks
tests/screenshots.cjs   Viewport × theme × mode sweep
tools/make-icons.cjs    Renders icons from an SVG template via Chromium
tools/make-screenshots.cjs  Renders manifest screenshots
.github/workflows/pages.yml  Pages deploy
```

### Data model (`localStorage` key `pomodoro-timer/v1`)
```js
{
  version: 1,
  settings: { durations:{focus:25,short:5,long:15}, longInterval:4, autoStartBreaks:false,
              autoStartFocus:false, sound:true, volume:0.7, tick:false, notifications:false,
              vibration:true, wakeLock:true, theme:'auto', dailyGoal:8 },
  timer: { mode:'focus'|'short'|'long', status:'idle'|'running'|'paused',
           duration(ms), remaining(ms, valid when idle/paused), endAt(epoch ms|null),
           startedAt, cycle(focus sessions toward long break), task },
  sessions: [{ id, start, end, duration, task }],   // capped at 500 (recent lists)
  days: { 'YYYY-MM-DD': { count, ms } },            // capped ~10 yrs; powers streaks/totals
  meta: { goalCelebrated:'YYYY-MM-DD'|null, awayNotice:{mode,at}|null }
}
```
- **Everything** loaded (storage, import, another tab) goes through `sanitize()` in `state.js`: it clamps numbers, checks enums and drops junk. `migrate()` is the hook for future schema versions.
- Store: `store.update(recipe, info)` mutates in place, notifies subscribers and writes once per microtask. `store.replace()` is used for import/reset. A `storage` event from another tab replaces the state (cross-tab sync).
- Limits: focus 1–99, short/long 1–60, longInterval 2–8, dailyGoal 1–24.

### Timer engine rules (`timer.js`)
- Never counts ticks. Running means `endAt` is set, and `remaining = endAt - Date.now()`.
- `check(now)` completes the phase when `now >= endAt`. The main loop calls it from rAF while visible, from a 1 s interval while hidden, and from a best-effort `setTimeout` at `endAt`.
- Completion records the session at **`endAt`** (not detection time), adds to `days[dayKey(endAt)]` and increments `cycle`.
- **Away rule:** if detection is more than 90 s late (`AWAY_THRESHOLD_MS`), the phase counts as "finished while you were away". The next phase is left idle (no auto-start) and `meta.awayNotice` drives the pill under the ring.
- **Auto-start** anchors the next phase at the previous `endAt`, so the schedule never drifts.
- Skip never counts. Long break follows when `cycle >= longInterval`. Completing or skipping a long break resets `cycle` to 0.
- `syncDuration()` applies edited durations only to an *idle* phase.
- Events: `control` (start/resume/pause/reset), `mode` (manual/skip), `complete` ({from,to,away,record,autoStarted,todayCount}).

### Rendering and loop (`main.js`)
- `render(state)` runs on every store change. It sets `data-status`, `data-mode` (via `applyModeAttr`, which can be held briefly during the completion beat), the play morph, dots, task, away note, Today panel and wake lock.
- `frame()` runs only while running or animating (to save battery). It drives the ring (`Ring.render`) and the digits (`Odometer.set`), and calls `onSecond()` once per displayed second (title, favicon, SR text, optional tick).
- **Completion choreography:** the ring holds full and the digits read 00:00 for about 820 ms with a pulse, halo flash, counter roll, dot pop and particles. After 520 ms the palette cross-fade starts. The ring then sweeps to the new phase. Daily goal adds a ring-edge particle bloom, the `goal` chime and a toast.
- **Undo:** mode switch, skip and reset on an in-progress timer show an Undo toast that restores the exact snapshot (a running timer keeps its original `endAt`).
- Views: timer ⇄ stats through the View Transitions API (`.views` has `view-transition-name: app-view`), with a CSS class fallback. Uses the `#stats` hash with history push/back.
- Zen: `.zen-out` elements fade/scale out with staggered `--zen-delay`. The ring is translated to the viewport centre and scaled (`--zen-x/--zen-y/--zen-s`, computed in `placeZenRing()`). A tap on the ring toggles the timer. Esc or the corner button exits.

### Design system (`tokens.css`)
- 18 colour tokens registered with `@property` (`--bg-a`, `--bg-b`, `--blob-1..3`, `--surface`, `--surface-strong`, `--hairline`, `--accent`, `--accent-text`, `--accent-soft`, `--accent-ink`, `--text`, `--text-muted`, `--ring-a`, `--ring-b`, `--ring-track`, `--glow`). The `html.is-ready` class enables the 760 ms cross-fade; it is added after first paint so the initial colours don't animate in.
- Worlds keyed by `html[data-theme][data-mode]`: Focus = powder blue, Short = butter/sand, Long = apricot/peach. Each has light and dark; dark is deep and muted, not black.
- Contrast was checked by script (WCAG AA): text ≥10:1, muted ≥4.7:1 even over blob colours, accent-text ≥4.5:1, accent-ink on accent ≥4.6:1.
- Type: Inter Var (bundled, `font-display: swap`). Digits are tabular, weight 300, `--tracking-display: -0.045em`, sized `ring-size × 0.235`.
- Motion tokens: `--ease-out`, `--ease-in-out`, `--ease-in`, plus generated **spring `linear()` curves** (`--ease-spring` ~7% overshoot, `--ease-spring-soft` ~2%) with cubic-bezier fallbacks. They are mirrored in JS as `EASE` in `ui.js`.
- `--ring-size` is fluid with `clamp()`/`dvh`, with overrides for wide (≥1000 px landscape: side panel), tablet portrait, short landscape and very large screens.

### Key UI primitives (`ui.js`)
- `Odometer`: fixed-width slots (an invisible "0" sizer, so there is no layout shift). Only the changed characters roll via WAAPI, and a countdown rolls downward. It masks the slot edges and staggers the higher digits slightly.
- `Ring`: `pathLength=1` dashoffset per frame plus a rotating glow tip. `sweep()` eases from the shown value to the live target.
- `PlayMorph`: two quads interpolate between a split triangle and two bars (rounded by `stroke-linejoin`). This avoids CSS `d`, which Safari lacks.
- `Layer`: sheet and modal with inert background, focus trap, Esc, and focus return. The bottom sheet (<768 px) has pointer drag-to-dismiss with velocity, a fling and a spring-back.
- `segmented()`: radiogroup semantics with arrow keys and a sliding pill (`--index`, transform only).
- `ripple()`, `magnetic()` (fine pointers only), `countUp()`, `toast()`, `announce()`.

### PWA
- Manifest: `id`/`start_url`/`scope` = `./`, standalone, icons (any + maskable + svg), screenshots (narrow and wide), Statistics shortcut.
- `sw.js`: precaches the shell with `cache: 'reload'`. Cache-first for same-origin requests; navigations return the cached `index.html`. Old `pomodoro-timer-*` caches are deleted on activate. New versions **wait** until the user taps "Update" in the toast (`SKIP_WAITING` message), so a running timer is never interrupted. The workflow stamps `const BUILD = "dev"` with the commit SHA so every deploy gets a fresh cache.
- iOS: apple-touch-icon, `apple-mobile-web-app-*` metas, safe-area insets, `100dvh`, audio unlock on first gesture, and a notification note when the app isn't installed.

---

## 4. Decisions and gotchas (read before changing things)

1. **The boot script in `<head>` sets `data-mode`/`data-theme` before paint.** Because of that, `applyModeAttr()` must always sync the segmented control and the label, not only when the attribute changes. That was a real bug, found in screenshots and now covered by a regression test.
2. **Focusable selector:** use `a[href]`, never `[href]`, because SVG `<use href>` matched it and broke the focus trap. Visibility is checked with `getClientRects().length`.
3. **`.ring__halo` and `.ring` need `pointer-events: none`.** The halo extends past the ring (inset −12%) and used to swallow clicks on the segmented control.
4. **Entrance animations use `animation-fill-mode: backwards`.** With `both`, the final transform would override zen and hover transforms.
5. **Autoplay policy:** `audio.play()` and `vibrate()` do nothing until `navigator.userActivation.hasBeenActive`, which avoids console warnings when a phase completes right after a reload.
6. **Undo "meaningful" check** uses live `timer.remaining()`. The stored `remaining` is only updated on pause.
7. The background blobs are radial gradients moved by transform only, with no `filter: blur`. The grain is a static tiled SVG noise.
8. Pulses are applied to inner elements (`.ring` svg, `.ring__halo`), not to `#ring-wrap`, whose transform belongs to zen positioning.
9. Space is left to a focused button (native activation) except in zen. Shortcuts are ignored while typing or while a layer is open.
10. Stats "back" uses `history.back()` only if we pushed the state. Otherwise it uses `replaceState`, so a direct `#stats` load doesn't navigate away.
11. Playwright's fake clock also fakes rAF. Use `clock.fastForward()` for long jumps; `runFor()` over minutes renders every frame and hangs. CSS transitions still run in real time, so screenshots taken under the fake clock can look mid-transition.

---

## 5. Keyboard shortcuts
`Space` start/pause · `R` reset · `S` skip · `1/2/3` modes · `Z` zen · `T` stats · `,` settings · `?` cheat sheet · `Esc` close/exit. Hints (tooltips, footer line) only show under `(hover: hover) and (pointer: fine)`.

---

## 6. How to run and test

```bash
npx http-server -p 8080 -c-1 -s .           # serve (no build step)
# In this cloud container Playwright is global:
NODE_PATH=/opt/node22/lib/node_modules node tests/functional.cjs http://localhost:8080/
NODE_PATH=/opt/node22/lib/node_modules node tests/screenshots.cjs http://localhost:8080/ <outDir> [--quick]
NODE_PATH=/opt/node22/lib/node_modules node tools/make-icons.cjs
NODE_PATH=/opt/node22/lib/node_modules node tools/make-screenshots.cjs http://localhost:8080/
# Elsewhere: npm install && npm run serve & npm test
```
Lighthouse in the container: start Chromium with `--remote-debugging-port=9222` (`/opt/pw-browsers/chromium-1243/chrome-linux64/chrome --headless=new --no-sandbox`), then `npx lighthouse@12.6.1 http://localhost:8080/ --port=9222`. Plain `--chrome-path` failed to launch.

### What the functional suite covers (20 tests)
Default load; start/pause/resume exactness with a mocked clock; laptop-sleep clock jump; live completion (task saved, cycle, palette, counter, dots); auto-start anchored to the true end; skip not counted, long break after 4, cycle reset; refresh restores a running timer; finished-while-closed (away note, counted once); midnight rollover (and the streak carrying over); reload in a break restores label/segmented/palette; mode switch + Undo; every keyboard shortcut; focus trap; settings persistence and the live duration update; export/import plus a bad file; stats chart and XSS escaping; blocked localStorage; reduced motion; offline through the service worker (including the font); manifest icons resolve.

### Viewports reviewed
360×640, 390×844, 430×932, 768×1024, 1024×768, 1280×800, 1440×900, 1920×1080, each in light and dark across all three modes, plus the stats and settings views, the running state, zen mode, the completion frame and the shortcuts modal.

---

## 7. Lighthouse notes
Local run (uncompressed http-server, simulated mobile): Perf 95 / A11y 100 / BP 100 / SEO 100. The remaining perf hints are unminified/uncompressed assets (GitHub Pages gzips) and 4 render-blocking CSS files. Lighthouse 12 removed the PWA category; installability is covered by the manifest, the service worker and the tests.

---

## 8. Ideas for later (not required by the brief)
- Concatenate the CSS into one file for one fewer round trip (keep the sources split).
- Optional fullscreen in zen mode.
- A per-task breakdown in stats; weekly or monthly ranges.
- Localisation (dates already use `Intl` and the user's locale).
- Background-accurate alerts while a tab is hidden for more than 5 minutes: Chrome may throttle timers to 1/min. Completion is still *recorded* at the exact `endAt`, but the chime or notification may come up to about a minute late. Push-based scheduling would need a server.

---

## 9. Commit history (intent)
1. Design system & app shell (HTML, tokens, base, components, animations, font)
2. Timer engine, state, storage and UI modules
3. PWA: manifest, service worker, icons, store screenshots
4. Tests and generators
5. Docs and Pages workflow (README, MEMORY.md, LICENSE, package.json)

---

## 10. Environment facts (cloud session)
- Node 22, Python 3.13 with Pillow, Playwright 1.63 global at `/opt/node22/lib/node_modules`, Chromium at `/opt/pw-browsers`.
- No valid `gh` token in the container (`GH_TOKEN` invalid). GitHub access goes through the git proxy and the GitHub MCP tools, which **cannot enable Pages or change repo settings**.
- The font came from the npm package `@fontsource-variable/inter` (file `inter-latin-wght-normal.woff2`).

---

## 11. Deployment status

- `main` was pushed first, so it is the repository's default branch. The same commits are on `claude/sharp-euler-wlq1ft`.
- GitHub Pages was already set to **Source: GitHub Actions**. The first run of `.github/workflows/pages.yml` (run id 40069565546) succeeded and deployed commit `d109944` to **https://coder-4847.github.io/Pomodoro-Timer/**.
- Every later push to `main` redeploys automatically. You can also run it by hand: Actions → "Deploy to GitHub Pages" → Run workflow.
- Annotation on the run: the Pages and checkout actions target Node 20, which GitHub is deprecating. They still work. When newer major versions are out, bump `actions/checkout`, `actions/configure-pages`, `actions/upload-pages-artifact` and `actions/deploy-pages`.

### Live check (from any normal browser; the session sandbox couldn't reach github.io)
1. Open https://coder-4847.github.io/Pomodoro-Timer/. The timer should appear with the entrance animation.
2. DevTools → Application → Manifest: no errors; the icons display.
3. Application → Service Workers: `sw.js` is "activated and running", and Cache Storage shows `pomodoro-timer-<sha>`.
4. Network tab: no 404s. Every asset loads from `/Pomodoro-Timer/...`.
5. Turn on Offline in DevTools and reload: the app still works.
6. On a phone: Add to Home Screen / Install app.
