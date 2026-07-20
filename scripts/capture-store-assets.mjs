import { chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

const root = path.resolve(import.meta.dirname, "..");
const extensionPath = path.join(root, "dist");
const outputDir = path.join(root, "store-assets");
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tldw-store-assets-"));

fs.mkdirSync(outputDir, { recursive: true });

const context = await chromium.launchPersistentContext(userDataDir, {
  channel: "chromium",
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
  ],
});

try {
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  const extensionId = new URL(worker.url()).host;

  const options = await context.newPage();
  await options.goto(`chrome-extension://${extensionId}/src/options/index.html#directapi`);
  await options.getByRole("heading", { name: "Direct API" }).waitFor();
  await options.screenshot({
    path: path.join(outputDir, "01-direct-api-setup-1280x800.png"),
  });

  const promo = await context.newPage();
  await promo.setViewportSize({ width: 440, height: 280 });
  await promo.setContent(`<!doctype html>
    <html>
      <head>
        <style>
          * { box-sizing: border-box; }
          html, body { width: 440px; height: 280px; margin: 0; overflow: hidden; }
          body {
            font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
            color: #f8fafc;
            background:
              radial-gradient(circle at 86% 16%, rgba(34,211,238,.22), transparent 28%),
              radial-gradient(circle at 12% 88%, rgba(168,85,247,.26), transparent 34%),
              linear-gradient(140deg, #090b18 0%, #11152a 52%, #21113b 100%);
          }
          .frame { position: relative; width: 100%; height: 100%; padding: 18px 20px; }
          .brand { display: flex; align-items: center; gap: 9px; color: #c4b5fd; font-size: 18px; font-weight: 850; letter-spacing: .11em; }
          .mark { width: 28px; height: 28px; display: grid; place-items: center; border-radius: 8px; background: linear-gradient(145deg,#7c3aed,#2563eb); box-shadow: 0 8px 24px rgba(124,58,237,.4); font-size: 10px; letter-spacing: -.06em; color: white; }
          h1 { margin: 12px 0 0; max-width: 300px; font-size: 28px; line-height: 1.02; letter-spacing: -.04em; }
          .sub { margin-top: 6px; color: #a5b4fc; font-size: 11px; font-weight: 650; letter-spacing: .02em; }
          .scene { position: absolute; left: 20px; right: 20px; bottom: 18px; height: 126px; display: grid; grid-template-columns: 1.08fr .92fr; gap: 10px; }
          .video { position: relative; border: 1px solid rgba(148,163,184,.22); border-radius: 13px; overflow: hidden; background: linear-gradient(145deg,#24283c,#10131f); box-shadow: 0 16px 38px rgba(0,0,0,.28); }
          .video:before { content: ""; position: absolute; inset: 0; background: radial-gradient(circle at 42% 42%,rgba(99,102,241,.38),transparent 35%); }
          .play { position: absolute; inset: 0; margin: auto; width: 38px; height: 38px; border-radius: 50%; background: rgba(255,255,255,.16); backdrop-filter: blur(8px); }
          .play:after { content: ""; position: absolute; left: 15px; top: 11px; border-left: 13px solid white; border-top: 8px solid transparent; border-bottom: 8px solid transparent; }
          .duration { position: absolute; right: 8px; bottom: 8px; padding: 3px 6px; border-radius: 5px; background: rgba(0,0,0,.72); font-size: 10px; font-weight: 750; }
          .summary { border: 1px solid rgba(167,139,250,.38); border-radius: 13px; padding: 12px; background: rgba(16,20,38,.9); box-shadow: 0 16px 38px rgba(0,0,0,.28); }
          .summary-head { display: flex; align-items: center; gap: 6px; color: #c4b5fd; font-size: 10px; font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
          .spark { color: #22d3ee; font-size: 13px; }
          .takeaway { margin-top: 9px; font-size: 12px; line-height: 1.25; font-weight: 760; color: #f8fafc; }
          .line { height: 5px; margin-top: 7px; border-radius: 9px; background: #334155; }
          .line.short { width: 72%; }
          .pill { display: inline-block; margin-top: 9px; padding: 4px 7px; border-radius: 99px; background: rgba(34,211,238,.12); color: #67e8f9; font-size: 8px; font-weight: 800; }
        </style>
      </head>
      <body>
        <div class="frame">
          <div class="brand"><span class="mark">TL;DW</span> TL;DW</div>
          <h1>Know it before you watch.</h1>
          <div class="sub">Your Gemini key. Your prompt. Your summary.</div>
          <div class="scene">
            <div class="video"><div class="play"></div><div class="duration">27:41</div></div>
            <div class="summary">
              <div class="summary-head"><span class="spark">✦</span> Summary</div>
              <div class="takeaway">The key idea, without the filler.</div>
              <div class="line"></div><div class="line short"></div>
              <div class="pill">Gemini 3.1 Flash-Lite</div>
            </div>
          </div>
        </div>
      </body>
    </html>`);
  await promo.screenshot({ path: path.join(outputDir, "promo-tile-440x280.png") });
} finally {
  await context.close();
  fs.rmSync(userDataDir, { recursive: true, force: true });
}

console.log("[tl;dw] captured store assets in store-assets/");
