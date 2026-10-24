/**
 * Renders the app icons (ring mark on the faded focus palette) to PNG with
 * headless Chromium. Run: node tools/make-icons.cjs
 */
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const OUT = path.join(__dirname, "..", "assets", "icons");

/** The mark as SVG. `pad` = inset of the ring for maskable safe zones. */
function markSvg({ size = 512, bg = true, rounded = true, ringScale = 1, mono = false }) {
  const c = 256;
  const r = 132 * ringScale;
  const w = 46 * ringScale;
  const radius = rounded ? 116 : 0;
  const arcLen = 0.74;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#f6f9fd"/><stop offset="1" stop-color="#d6e3f2"/>
    </linearGradient>
    <radialGradient id="blob" cx="0.78" cy="0.84" r="0.6">
      <stop offset="0" stop-color="#f9dccb" stop-opacity="0.75"/><stop offset="1" stop-color="#f9dccb" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="blob2" cx="0.18" cy="0.12" r="0.5">
      <stop offset="0" stop-color="#f6ebc7" stop-opacity="0.7"/><stop offset="1" stop-color="#f6ebc7" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="arc" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#9fbde0"/><stop offset="1" stop-color="#4f769f"/>
    </linearGradient>
    <radialGradient id="glow"><stop offset="0.5" stop-color="#7fa3cc" stop-opacity="0"/><stop offset="0.68" stop-color="#7fa3cc" stop-opacity="0.22"/><stop offset="1" stop-color="#7fa3cc" stop-opacity="0"/></radialGradient>
  </defs>
  ${bg ? `<rect width="512" height="512" rx="${radius}" fill="url(#bg)"/>
  <rect width="512" height="512" rx="${radius}" fill="url(#blob)"/>
  <rect width="512" height="512" rx="${radius}" fill="url(#blob2)"/>
  <circle cx="${c}" cy="${c}" r="${r + w * 1.6}" fill="url(#glow)"/>` : ""}
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${mono ? "#ffffff" : "#4f769f"}" stroke-opacity="${mono ? 0.35 : 0.12}" stroke-width="${w}"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="${mono ? "#ffffff" : "url(#arc)"}" stroke-width="${w}" stroke-linecap="round"
    pathLength="1" stroke-dasharray="${arcLen} 1" transform="rotate(-90 ${c} ${c})"/>
</svg>`;
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true });
  // Favicon SVG (also used as a manifest "any" icon)
  fs.writeFileSync(path.join(OUT, "favicon.svg"), markSvg({}).replace(/\n\s*/g, " "));

  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  const render = async (file, size, opts, transparent = true) => {
    await page.setViewportSize({ width: size, height: size });
    const svg = markSvg({ size, ...opts });
    await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
    await page.screenshot({ path: path.join(OUT, file), omitBackground: transparent, clip: { x: 0, y: 0, width: size, height: size } });
  };
  await render("favicon-32.png", 32, {});
  await render("icon-192.png", 192, {});
  await render("icon-512.png", 512, {});
  // Maskable: full-bleed background, ring inside the 80% safe circle.
  await render("maskable-192.png", 192, { rounded: false, ringScale: 0.78 }, false);
  await render("maskable-512.png", 512, { rounded: false, ringScale: 0.78 }, false);
  // Apple touch icon: opaque square, iOS applies its own corner mask.
  await render("apple-touch-icon.png", 180, { rounded: false, ringScale: 0.86 }, false);
  // Android notification badge: white silhouette on transparent.
  await render("badge-72.png", 72, { bg: false, mono: true, ringScale: 1.25 });
  await browser.close();
  console.log("icons written to", OUT);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
