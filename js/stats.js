/**
 * stats.js — pure statistics helpers plus the renderers for the "Today"
 * panel and the Statistics view (hand-built SVG chart, no library).
 */

import { dayKey } from "./state.js";
import { $, animate, countUp, EASE, esc, icon, reducedMotion } from "./ui.js";

/* ---- Pure helpers ---------------------------------------------------- */

const dateFromKey = (key) => {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d, 12); // noon: immune to DST edges
};
const shiftDay = (date, n) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + n, 12);

export function formatDuration(ms) {
  const totalMin = Math.round(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h === 0) return `${m}m`;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export function dayStats(days, now = Date.now()) {
  const d = days[dayKey(now)];
  return { count: d?.count ?? 0, ms: d?.ms ?? 0 };
}

/** The last 7 calendar days ending today, oldest first. */
export function weekSeries(days, now = Date.now()) {
  const today = shiftDay(new Date(now), 0);
  const fmt = new Intl.DateTimeFormat(undefined, { weekday: "short" });
  const long = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" });
  const out = [];
  for (let i = 6; i >= 0; i--) {
    const date = shiftDay(today, -i);
    const key = dayKey(date.getTime());
    const d = days[key];
    out.push({
      key,
      label: fmt.format(date),
      longLabel: long.format(date),
      count: d?.count ?? 0,
      ms: d?.ms ?? 0,
      isToday: i === 0,
    });
  }
  return out;
}

/** Current streak counts today if it has a session, otherwise runs through yesterday. */
export function streaks(days, now = Date.now()) {
  const has = (date) => (days[dayKey(date.getTime())]?.count ?? 0) > 0;
  let cursor = shiftDay(new Date(now), 0);
  if (!has(cursor)) cursor = shiftDay(cursor, -1);
  let current = 0;
  while (has(cursor)) {
    current++;
    cursor = shiftDay(cursor, -1);
  }
  const keys = Object.keys(days).filter((k) => days[k].count > 0).sort();
  let longest = 0;
  let run = 0;
  let prev = null;
  for (const k of keys) {
    const date = dateFromKey(k);
    run = prev && dayKey(shiftDay(prev, 1).getTime()) === k ? run + 1 : 1;
    longest = Math.max(longest, run);
    prev = date;
  }
  return { current, longest: Math.max(longest, current) };
}

export function totals(days) {
  let count = 0;
  let ms = 0;
  let first = null;
  for (const [k, v] of Object.entries(days)) {
    count += v.count;
    ms += v.ms;
    if (!first || k < first) first = k;
  }
  return { count, ms, since: first ? dateFromKey(first) : null };
}

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

function dayHeading(ts, now = Date.now()) {
  const key = dayKey(ts);
  if (key === dayKey(now)) return "Today";
  if (key === dayKey(shiftDay(new Date(now), -1).getTime())) return "Yesterday";
  return new Intl.DateTimeFormat(undefined, { weekday: "short", month: "short", day: "numeric" }).format(ts);
}

function sessionItem(rec, { withDay = false } = {}) {
  const label = rec.task ? esc(rec.task) : "Focus session";
  const when = `${withDay ? `${dayHeading(rec.end)} · ` : ""}${timeFmt.format(rec.end)}`;
  return `<li class="session">
      <span class="session__dot" aria-hidden="true"></span>
      <span class="session__task${rec.task ? "" : " is-empty"}">${label}</span>
      <span class="session__meta">${when} · ${formatDuration(rec.duration)}</span>
    </li>`;
}

/* ---- Today panel ----------------------------------------------------- */

export function renderToday(refs, state, now = Date.now()) {
  const { count, ms } = dayStats(state.days, now);
  const goal = state.settings.dailyGoal;
  const { current } = streaks(state.days, now);
  refs.counter.set(String(count), { direction: 1 });
  refs.countSr.textContent = String(count);
  refs.goalFill.style.setProperty("--goal", String(Math.min(1, count / goal)));
  refs.goalText.textContent = count >= goal ? `Goal met · ${count} of ${goal}` : `${count} of ${goal}`;
  refs.goal.classList.toggle("is-met", count >= goal);
  refs.time.textContent = formatDuration(ms);
  refs.streak.textContent = `${current} ${current === 1 ? "day" : "days"}`;
  refs.flame.classList.toggle("is-lit", current > 0);
  refs.date.textContent = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "short", day: "numeric" }).format(now);

  const recent = state.sessions.slice(-4).reverse();
  const html = recent.length
    ? recent.map((r) => sessionItem(r, { withDay: dayKey(r.end) !== dayKey(now) })).join("")
    : `<li class="empty">Completed focus sessions will appear here.</li>`;
  if (refs.recent.dataset.html !== html) {
    refs.recent.innerHTML = html;
    refs.recent.dataset.html = html;
  }
}

/* ---- Statistics view ------------------------------------------------- */

function chartSvg(series, goal, width) {
  const height = 190;
  const top = 26;
  const bottom = 28;
  const plotH = height - top - bottom;
  const max = Math.max(goal, ...series.map((d) => d.count), 1) * 1.08;
  const slot = width / series.length;
  const barW = Math.min(38, slot * 0.56);
  const r = Math.min(10, barW / 2);
  const y = (v) => top + plotH - (v / max) * plotH;
  const goalY = y(goal);

  const bars = series
    .map((d, i) => {
      const cx = slot * i + slot / 2;
      const x = cx - barW / 2;
      const h = (d.count / max) * plotH;
      const by = top + plotH - h;
      const rr = Math.min(r, h / 2);
      const path = h > 0
        ? `M${x} ${top + plotH}V${by + rr}Q${x} ${by} ${x + rr} ${by}H${x + barW - rr}Q${x + barW} ${by} ${x + barW} ${by + rr}V${top + plotH}Z`
        : "";
      const title = `${d.longLabel}: ${d.count} ${d.count === 1 ? "session" : "sessions"}, ${formatDuration(d.ms)}`;
      return `<g class="chart__col" data-i="${i}">
        <title>${esc(title)}</title>
        <rect class="chart__bar-track" x="${x}" y="${top}" width="${barW}" height="${plotH}" rx="${r}" />
        ${path ? `<path class="chart__bar${d.isToday ? " is-today" : ""}" d="${path}" />` : ""}
        ${d.count ? `<text class="chart__value" x="${cx}" y="${by - 8}">${d.count}</text>` : ""}
        <text class="chart__label${d.isToday ? " is-today" : ""}" x="${cx}" y="${height - 8}">${esc(d.label)}</text>
      </g>`;
    })
    .join("");

  return `<svg class="chart" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}" role="img" aria-labelledby="chart-title chart-desc">
    <desc id="chart-desc">${esc(series.map((d) => `${d.label} ${d.count}`).join(", "))}</desc>
    <defs><linearGradient id="bar-grad" x1="0" y1="0" x2="0" y2="1"><stop class="bar-stop-a" offset="0"/><stop class="bar-stop-b" offset="1"/></linearGradient></defs>
    <line class="chart__goal" x1="0" x2="${width}" y1="${goalY}" y2="${goalY}" />
    <text class="chart__goal-label" x="${width}" y="${goalY - 6}" text-anchor="end">Goal ${goal}</text>
    ${bars}
  </svg>`;
}

export function renderStats(container, state, { animateIn = true } = {}) {
  const now = Date.now();
  const today = dayStats(state.days, now);
  const week = weekSeries(state.days, now);
  const weekCount = week.reduce((a, d) => a + d.count, 0);
  const weekMs = week.reduce((a, d) => a + d.ms, 0);
  const { current, longest } = streaks(state.days, now);
  const total = totals(state.days);
  const goal = state.settings.dailyGoal;
  const sinceFmt = new Intl.DateTimeFormat(undefined, { month: "short", year: "numeric" });

  const tile = (i, label, iconName, value, unit, sub, cls = "") => `
    <article class="tile ${cls}" style="--i:${i}">
      <p class="tile__label">${icon(iconName)}${label}</p>
      <p class="tile__value"><span data-count="${value}">${value}</span><span class="tile__unit">${unit}</span></p>
      <p class="tile__sub">${sub}</p>
    </article>`;

  const recent = state.sessions.slice(-8).reverse();
  const active = week.filter((d) => d.count > 0);
  const avg = active.length ? weekCount / 7 : 0;
  const best = week.reduce((b, d) => (d.count > (b?.count ?? 0) ? d : b), null);
  const groups = [];
  for (const r of recent) {
    const h = dayHeading(r.end, now);
    if (!groups.length || groups[groups.length - 1].h !== h) groups.push({ h, items: [] });
    groups[groups.length - 1].items.push(r);
  }
  const recentHtml = groups.length
    ? groups
        .map((g) => `<h4 class="eyebrow session-group">${esc(g.h)}</h4><ul class="session-list">${g.items.map((r) => sessionItem(r)).join("")}</ul>`)
        .join("")
    : `<p class="empty">No sessions yet. Finish a focus session and it will show up here.</p>`;

  container.innerHTML = `
    ${tile(0, "Today", "target", today.count, today.count === 1 ? "session" : "sessions", `${formatDuration(today.ms)} focused`)}
    ${tile(1, "This week", "stats", weekCount, weekCount === 1 ? "session" : "sessions", `${formatDuration(weekMs)} focused`)}
    ${tile(2, "Current streak", "flame", current, current === 1 ? "day" : "days", current ? "Keep it going" : "Start one today", "tile--streak")}
    ${tile(3, "Longest streak", "sparkle", longest, longest === 1 ? "day" : "days", "Personal best")}
    <article class="tile tile--wide tile--chart" style="--i:4">
      <div class="tile__head"><h3 class="tile__title" id="chart-title">Last 7 days</h3><span class="tile__sub">${weekCount} ${weekCount === 1 ? "session" : "sessions"}</span></div>
      <div class="chart-host"></div>
    </article>
    <article class="tile tile--wide tile--total" style="--i:5">
      <p class="tile__label">${icon("clock")}Total focus time</p>
      <p class="tile__value"><span data-total>${formatDuration(total.ms)}</span></p>
      <p class="tile__sub">${total.count} ${total.count === 1 ? "session" : "sessions"}${total.since ? ` since ${sinceFmt.format(total.since)}` : ""}</p>
      <dl class="total-facts">
        <div class="fact"><dt>Daily average</dt><dd>${avg ? avg.toFixed(1).replace(/\.0$/, "") : "0"}<span class="tile__unit">/ day</span></dd></div>
        <div class="fact"><dt>Best day this week</dt><dd>${best ? `${esc(best.label)} · ${best.count}` : "—"}</dd></div>
      </dl>
    </article>
    <article class="tile tile--recent tile--wide" style="--i:6">
      <div class="tile__head"><h3 class="tile__title">Recent sessions</h3></div>
      <div class="recent-body">${recentHtml}</div>
    </article>`;

  const flame = $(".tile--streak .icon", container);
  if (current > 0) flame.classList.add("flame", "is-lit");
  else flame.classList.add("flame");

  const host = $(".chart-host", container);
  const draw = (withAnim) => {
    const width = Math.max(240, Math.round(host.clientWidth || 300));
    host.innerHTML = chartSvg(week, goal, width);
    if (withAnim && !reducedMotion()) {
      host.querySelectorAll(".chart__bar").forEach((bar) => {
        const i = Number(bar.closest(".chart__col").dataset.i);
        bar.animate([{ transform: "scaleY(0)" }, { transform: "scaleY(1)" }], {
          duration: 900,
          delay: 260 + i * 70,
          easing: EASE.spring,
          fill: "backwards",
        });
      });
      host.querySelectorAll(".chart__value").forEach((v) => {
        const i = Number(v.closest(".chart__col").dataset.i);
        animate(v, [{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "none" }], {
          duration: 420,
          delay: 620 + i * 70,
          easing: EASE.out,
          fill: "backwards",
        });
      });
    }
  };
  draw(animateIn);

  if (animateIn) {
    container.querySelectorAll("[data-count]").forEach((el) => countUp(el, Number(el.dataset.count), { duration: 900 }));
  }
  return { redraw: () => draw(false) };
}
