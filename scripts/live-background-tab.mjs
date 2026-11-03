/**
 * Live check of the no-key Gemini tab flow with the Gemini tab truly in the
 * background, against real YouTube and gemini.google.com (signed out).
 *
 * Why not Playwright: its default launch, and any debugger attached to a page,
 * make every tab report itself visible and focused, so a "background" tab
 * there behaves like a front one and background-only bugs never show (v1.1.0
 * shipped one: every background send timed out). This script starts plain
 * Chromium with the built extension and drives everything through the
 * extension's service worker over raw CDP, attaching to no page until the run
 * is over, so the Gemini tab gets exactly what real Chrome gives a background
 * tab. Run it under a virtual display:
 *
 *   npx vite build --outDir dist-live
 *   ~/scripts/browser-slot xvfb-run -a node scripts/live-background-tab.mjs dist-live dQw4w9WgXcQ
 *
 * Arguments: the built extension folder, then one or more video ids. Options:
 * --front brings the Gemini tab to the front (the control), --runs=N repeats.
 * Audio is muted (--mute-audio, every video paused and muted). Prints one line
 * per run and exits non-zero if any run didn't put a summary on the page.
 * Artifacts (log, panel text, screenshots) go to test-results/live-background-tab/.
 * It sends real prompts to Gemini, so it is a manual check, never part of CI.
 */
/* global fetch, WebSocket, setTimeout, Buffer */
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { chromium } from "@playwright/test";

const args = process.argv.slice(2);
const front = args.includes("--front");
const runs = Number(args.find((a) => a.startsWith("--runs="))?.split("=")[1] ?? 1);
const [extDir, ...videoIds] = args.filter((a) => !a.startsWith("--"));
if (!extDir || !videoIds.length) {
  console.error("Usage: node scripts/live-background-tab.mjs <built-extension-dir> <videoId>... [--front] [--runs=N]");
  process.exit(2);
}
if (!process.env.DISPLAY) {
  console.error("No display: run it under xvfb-run so Chromium runs headed without a visible window.");
  process.exit(2);
}
const ext = path.resolve(extDir);
const outRoot = path.resolve("test-results/live-background-tab");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function runOnce(videoId, label) {
  const out = path.join(outRoot, label);
  fs.mkdirSync(out, { recursive: true });
  const logFile = fs.createWriteStream(path.join(out, "log.txt"));
  const t0 = Date.now();
  const log = (...a) => logFile.write(`[${((Date.now() - t0) / 1000).toFixed(1)}s] ${a.join(" ")}\n`);
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "tldw-live-"));
  // Port 0 lets Chromium pick a free port and write it to DevToolsActivePort,
  // so parallel runs never share (and drive) one browser.
  let port = 0;
  const proc = spawn(chromium.executablePath(), [
    `--user-data-dir=${profile}`, "--remote-debugging-port=0", "--no-first-run", "--no-default-browser-check",
    `--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--mute-audio",
    "--autoplay-policy=user-gesture-required", "--window-size=1280,900", "about:blank",
  ], { stdio: "ignore", env: { ...process.env, PULSE_SERVER: "unix:/nonexistent" } });

  let ws;
  try {
    let sw;
    for (let i = 0; i < 60 && !sw; i++) {
      await sleep(500);
      if (!port) {
        try { port = Number(fs.readFileSync(path.join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || 0; } catch { /* not yet */ }
        if (!port) continue;
      }
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json()).catch(() => []);
      sw = list.find((t) => t.type === "service_worker" && t.url.endsWith("/service-worker-loader.js"));
    }
    if (!sw) throw new Error("the extension's service worker never started");
    ws = new WebSocket(sw.webSocketDebuggerUrl);
    await new Promise((r) => ws.addEventListener("open", r));
    let id = 0;
    const pending = new Map();
    ws.addEventListener("message", (e) => {
      const m = JSON.parse(e.data);
      if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
    });
    const send = (method, params) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
    const ev = async (src) => {
      const m = await send("Runtime.evaluate", { expression: `(${src})()`, awaitPromise: true, returnByValue: true });
      if (m.result?.exceptionDetails) throw new Error(m.result.exceptionDetails.exception?.description ?? "eval error");
      return m.result?.result?.value;
    };
    const inTab = (tabId, fn, world = "ISOLATED") => ev(`async () => {
      const [r] = await chrome.scripting.executeScript({ target: { tabId: ${tabId} }, world: "${world}", func: ${fn} });
      return r?.result;
    }`);

    await sleep(1500);
    const ytTab = await ev(`async () => {
      for (const t of await chrome.tabs.query({})) if ((t.url || t.pendingUrl || "").startsWith("chrome-extension://")) await chrome.tabs.remove(t.id);
      const [t] = await chrome.tabs.query({});
      await chrome.tabs.update(t.id, { url: "https://www.youtube.com/watch?v=${videoId}", active: true });
      return t.id;
    }`);
    const mute = `() => {
      const f = () => document.querySelectorAll("video,audio").forEach((v) => { v.muted = true; v.volume = 0; v.pause(); });
      f();
      if (!window.__tldwMuted) {
        window.__tldwMuted = 1;
        new MutationObserver(f).observe(document, { childList: true, subtree: true });
        document.addEventListener("play", f, true);
      }
    }`;
    let title = "";
    for (let i = 0; i < 120 && !title; i++) {
      await sleep(500);
      const r = await inTab(ytTab, `() => {
        const consent = [...document.querySelectorAll("button")].find((b) => /Accept all|Reject all/.test(b.textContent));
        if (consent) consent.click();
        return document.getElementById("tldw-watch-btn") ? document.title : "";
      }`).catch((e) => { log("page read failed:", e.message); return ""; });
      await inTab(ytTab, mute, "MAIN").catch(() => {});
      title = r || "";
    }
    if (!title) throw new Error("the TL;DW button never appeared");
    log("title:", title);
    await sleep(2000);
    await inTab(ytTab, mute, "MAIN");
    const clicked = Date.now();
    await inTab(ytTab, `() => document.getElementById("tldw-watch-btn").click()`);

    let result = null;
    let lastPanel = "";
    let gemTab = null;
    while (Date.now() - clicked < 240_000) {
      await sleep(2500);
      const tabs = await ev(`async () => (await chrome.tabs.query({})).map((t) => ({ id: t.id, active: t.active, host: new URL(t.url || t.pendingUrl || "about:blank").host }))`);
      const g = tabs.find((t) => t.host === "gemini.google.com");
      if (g && gemTab === null) {
        gemTab = g.id;
        log("gemini tab opened, active:", g.active);
        if (front) await ev(`async () => chrome.tabs.update(${gemTab}, { active: true })`);
      }
      const panel = await inTab(ytTab, `() => {
        const p = document.getElementById("tldw-summary");
        return p ? { text: p.innerText, step: !!p.querySelector("[data-tldw-step]"), details: !!p.querySelector("[data-tldw-details-toggle]") } : null;
      }`).catch(() => null);
      if (panel && panel.text !== lastPanel) { log("panel:", panel.text.replace(/\s+/g, " ").slice(0, 300)); lastPanel = panel.text; }
      if (panel && !panel.step) { result = panel; break; }
    }
    const seconds = ((Date.now() - clicked) / 1000).toFixed(1);
    const ok = !!result && !/Couldn't get the summary/.test(result.text);
    fs.writeFileSync(path.join(out, "panel.txt"), result?.text ?? lastPanel);
    // Screenshots only now: attaching to a page earlier would change its visibility.
    const shot = async (tabId, file) => {
      await ev(`async () => chrome.tabs.update(${tabId}, { active: true })`);
      await sleep(800);
      const url = (await ev(`async () => (await chrome.tabs.get(${tabId})).url`)) ?? "";
      const list = await fetch(`http://127.0.0.1:${port}/json/list`).then((r) => r.json());
      const target = list.find((t) => t.type === "page" && t.url === url);
      if (!target) return;
      const page = new WebSocket(target.webSocketDebuggerUrl);
      await new Promise((r) => page.addEventListener("open", r));
      const png = await new Promise((r) => {
        page.addEventListener("message", (e) => { const m = JSON.parse(e.data); if (m.id === 1) r(m.result?.data); });
        page.send(JSON.stringify({ id: 1, method: "Page.captureScreenshot", params: {} }));
      });
      if (png) fs.writeFileSync(path.join(out, file), Buffer.from(png, "base64"));
      page.close();
    };
    await shot(ytTab, "youtube.png").catch(() => {});
    if (gemTab !== null) await shot(gemTab, "gemini.png").catch(() => {});
    const label = result?.text.match(/^(Summarized from part[^\n]*|No transcript, so[^\n]*|Watched by[^\n]*)$/m)?.[1] ?? "";
    return { ok, seconds, details: !!result?.details, label, text: (result?.text ?? lastPanel).replace(/\s+/g, " ").slice(0, 140) };
  } catch (err) {
    log("error:", err?.stack ?? String(err));
    return { ok: false, seconds: "-", details: false, label: "", text: String(err?.message ?? err) };
  } finally {
    ws?.close();
    proc.kill();
    await sleep(1500);
    fs.rmSync(profile, { recursive: true, force: true });
    logFile.end();
  }
}

let failures = 0;
for (const videoId of videoIds) {
  for (let i = 1; i <= runs; i++) {
    const label = `${videoId}-${front ? "front" : "bg"}-${i}`;
    const r = await runOnce(videoId, label);
    if (!r.ok) failures += 1;
    console.log(`${r.ok ? "PASS" : "FAIL"} ${label} ${r.seconds}s details=${r.details ? "yes" : "no"}` +
      `${r.label ? ` label="${r.label}"` : ""} :: ${r.text}`);
  }
}
process.exit(failures ? 1 : 0);
