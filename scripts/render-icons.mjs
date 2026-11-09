/**
 * Renders the extension icons in public/icons/ from the SVG sources in icon/.
 *
 *   node scripts/render-icons.mjs
 *
 * icon/tl-dw.svg is the mark n8builds.dev uses (a play button turning into
 * summary lines). icon/tl-dw-16.svg is the same mark drawn on a 16-pixel grid,
 * so the toolbar icon stays sharp instead of a blurry downscale.
 */
import { chromium } from "@playwright/test";
import fs from "fs";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const out = path.join(root, "public", "icons");
const svg = (name) => fs.readFileSync(path.join(root, "icon", name), "utf8");
const jobs = [
  [16, svg("tl-dw-16.svg")],
  [32, svg("tl-dw.svg")],
  [48, svg("tl-dw.svg")],
  [128, svg("tl-dw.svg")],
];

const browser = await chromium.launch();
try {
  for (const [size, source] of jobs) {
    const page = await browser.newPage({ viewport: { width: size, height: size } });
    const sized = source.replace("<svg ", `<svg width="${size}" height="${size}" `);
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}svg{display:block}</style>${sized}`,
    );
    await page.screenshot({ path: path.join(out, `tl-dw-${size}.png`), omitBackground: true });
    await page.close();
  }
} finally {
  await browser.close();
}
console.log("[tl;dw] rendered public/icons/tl-dw-{16,32,48,128}.png");
