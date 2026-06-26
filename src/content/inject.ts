/**
 * Auto-fill injector for chat destinations (Gemini, ChatGPT, Claude, NotebookLM). On load
 * it asks the background worker whether this tab has a pending prompt; if so it
 * types the prompt into the site's composer and (optionally) submits. If the
 * composer can't be found or filled, it falls back to copying the prompt to the
 * clipboard and showing a toast so the user can paste it.
 *
 * Selectors are per-site and inherently brittle — when a site redesigns its
 * composer, add the new selector here. Each list runs most-specific first and
 * ends with generic fallbacks (any visible contenteditable / submit button), so
 * one renamed id or data-testid doesn't take the whole site down. Matching is
 * visibility-filtered (see isVisible) so those generic fallbacks can't latch
 * onto a hidden/off-screen element. The clipboard fallback covers the rest.
 */

type SiteConfig = {
  name: string;
  editorSelectors: string[];
  sendSelectors: string[];
  /** Buttons present only while the AI is generating — disappear when done. */
  stopSelectors: string[];
  /** Containers that hold the AI's last response text. */
  responseSelectors: string[];
};

function configForHost(host: string): SiteConfig | null {
  if (host.endsWith("gemini.google.com")) {
    return {
      name: "Gemini",
      editorSelectors: [
        'div.ql-editor[contenteditable="true"]',
        'rich-textarea div[contenteditable="true"]',
        'div[contenteditable="true"][role="textbox"]',
        'div[contenteditable="true"]',
        "textarea",
      ],
      sendSelectors: [
        'button[aria-label*="Send" i]',
        "button.send-button",
        'button[mattooltip*="Send" i]',
      ],
      stopSelectors: [
        'button[aria-label*="Stop" i]',
        'button[aria-label*="Cancel" i]',
      ],
      responseSelectors: [
        "model-response",
        ".response-container",
        "[data-response-index]",
      ],
    };
  }
  if (host.endsWith("chatgpt.com")) {
    return {
      name: "ChatGPT",
      editorSelectors: [
        "div.ProseMirror#prompt-textarea",
        'div[contenteditable="true"]#prompt-textarea',
        "#prompt-textarea",
        "div.ProseMirror",
        'div[contenteditable="true"]',
      ],
      sendSelectors: [
        'button[data-testid="send-button"]',
        "#composer-submit-button",
        'button[aria-label*="Send" i]',
        'form button[type="submit"]',
      ],
      stopSelectors: [
        'button[data-testid="stop-button"]',
        'button[aria-label*="Stop" i]',
      ],
      responseSelectors: [
        '[data-message-author-role="assistant"]',
      ],
    };
  }
  if (host.endsWith("claude.ai")) {
    return {
      name: "Claude",
      editorSelectors: [
        'div[contenteditable="true"].ProseMirror',
        'div[aria-label*="prompt" i][contenteditable="true"]',
        'fieldset div[contenteditable="true"]',
        'div[contenteditable="true"]',
      ],
      sendSelectors: [
        'button[aria-label*="Send message" i]',
        'button[aria-label*="Send" i]',
      ],
      stopSelectors: [
        'button[aria-label*="Stop" i]',
      ],
      responseSelectors: [
        '[data-testid="assistant-message"]',
        ".font-claude-message",
      ],
    };
  }
  return null;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor<T extends Element>(
  selectors: string[],
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      // Earlier selectors are more specific; within a selector prefer the first
      // visible match so generic fallbacks don't grab a hidden element.
      for (const el of document.querySelectorAll<T>(sel)) {
        if (isVisible(el)) return el;
      }
    }
    await sleep(150);
  }
  return null;
}

function insertText(editor: Element, text: string): boolean {
  (editor as HTMLElement).focus();

  if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
    // Prefer execCommand: it fires the native input events frameworks (Angular,
    // CDK) listen to, which is what actually enables a disabled submit button.
    editor.select();
    let ok = false;
    try {
      ok = document.execCommand("insertText", false, text);
    } catch {
      ok = false;
    }
    if (!ok || editor.value !== text) {
      const proto =
        editor instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(editor, text);
      editor.dispatchEvent(new Event("input", { bubbles: true }));
      editor.dispatchEvent(new Event("change", { bubbles: true }));
    }
    return editor.value.includes(text.slice(0, 20));
  }

  // Select all existing content so execCommand("insertText") replaces it.
  // Without an active selection the command silently no-ops on some sites.
  try {
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch {
    /* selection setup failed — execCommand will try anyway */
  }

  let ok = false;
  try {
    ok = document.execCommand("insertText", false, text);
  } catch {
    ok = false;
  }
  if (!ok || !(editor.textContent ?? "").includes(text.slice(0, 20))) {
    editor.textContent = text;
    // Fire beforeinput then input so React/Vue/Svelte state machines all update.
    editor.dispatchEvent(
      new InputEvent("beforeinput", {
        bubbles: true,
        cancelable: true,
        inputType: "insertText",
        data: text,
      }),
    );
    editor.dispatchEvent(
      new InputEvent("input", {
        bubbles: true,
        inputType: "insertText",
        data: text,
      }),
    );
  }
  return (editor.textContent ?? "").includes(text.slice(0, 20));
}

async function findEnabledSendButton(
  sendSelectors: string[],
  timeoutMs: number,
): Promise<HTMLButtonElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of sendSelectors) {
      for (const btn of document.querySelectorAll<HTMLButtonElement>(sel)) {
        if (
          !btn.disabled &&
          btn.getAttribute("aria-disabled") !== "true" &&
          isVisible(btn)
        ) {
          return btn;
        }
      }
    }
    await sleep(120);
  }
  return null;
}

function showToast(text: string): void {
  const el = document.createElement("div");
  el.textContent = text;
  Object.assign(el.style, {
    position: "fixed",
    bottom: "24px",
    left: "50%",
    transform: "translateX(-50%)",
    zIndex: "2147483647",
    background: "#1f2937",
    color: "#fff",
    padding: "10px 16px",
    borderRadius: "8px",
    font: "14px/1.4 system-ui, sans-serif",
    boxShadow: "0 4px 16px rgba(0,0,0,.3)",
    maxWidth: "80vw",
  });
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 5000);
}

async function fallbackToClipboard(prompt: string, site: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(prompt);
    showToast(`TL;DW: couldn't auto-fill ${site} — prompt copied, paste it (Ctrl+V) to send.`);
  } catch {
    showToast(`TL;DW: couldn't auto-fill ${site}. Open the popup to copy the prompt.`);
  }
}

/** Find a clickable element by its visible text (case-insensitive contains). */
function findClickableByText(texts: string[]): HTMLElement | null {
  const wanted = texts.map((t) => t.toLowerCase());
  const els = document.querySelectorAll<HTMLElement>(
    'button, [role="button"], [role="menuitem"], a',
  );
  for (const el of els) {
    if ((el as HTMLButtonElement).disabled) continue;
    const label = (el.getAttribute("aria-label") ?? el.textContent ?? "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
    if (label && wanted.some((t) => label.includes(t))) return el;
  }
  return null;
}

async function waitForClickableByText(
  texts: string[],
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const el = findClickableByText(texts);
    if (el) return el;
    await sleep(150);
  }
  return null;
}

/**
 * Whether an element is actually on-screen and interactable. Lets the generic
 * fallback selectors (e.g. a bare contenteditable) skip hidden/off-screen
 * matches — a stale composer left in the DOM, an inactive tab panel — and wait
 * for the real, visible one instead of typing into the wrong box.
 */
function isVisible(el: Element): boolean {
  if (!el.isConnected) return false;
  const r = el.getBoundingClientRect();
  if (r.width === 0 && r.height === 0) return false;
  const style = getComputedStyle(el);
  return style.visibility !== "hidden" && style.display !== "none";
}

const nlog = (...args: unknown[]) => console.log("[TL;DW NotebookLM]", ...args);
const log = (...args: unknown[]) => console.log("[TL;DW inject]", ...args);

function editorLabel(el: HTMLElement): string {
  return [
    el.getAttribute("aria-label"),
    el.getAttribute("placeholder"),
    el.getAttribute("formcontrolname"),
  ]
    .join(" ")
    .toLowerCase();
}

/** Boxes on the page that are NOT the paste box (search + the ask composer). */
function isNotPasteBox(el: HTMLElement): boolean {
  const hay = editorLabel(el);
  return (
    hay.includes("search the web") ||
    hay.includes("discover sources") ||
    hay.includes("discoversources") ||
    hay.includes("ask a question") ||
    hay.includes("ask anything") ||
    hay.includes("create some") ||
    hay.includes("notebook title") ||
    hay.includes("untitled") ||
    hay.includes("name your")
  );
}

function editorIsEmpty(el: HTMLElement): boolean {
  const v =
    el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
      ? el.value
      : el.textContent;
  return !(v ?? "").trim();
}

/**
 * Find the input box in an "add source" panel: a visible, empty field that
 * isn't the search box or the "ask" composer. Prefers a box whose label matches
 * one of `prefer` (e.g. "paste", "url"); otherwise the largest dialog-scoped
 * candidate.
 */
const TEXTY_INPUT_TYPES = new Set(["text", "url", "search", "email", ""]);

function findSourceBox(prefer: string[]): HTMLElement | null {
  const all = Array.from(
    document.querySelectorAll<HTMLElement>(
      "textarea, input, div[contenteditable=\"true\"]",
    ),
  ).filter((el) => {
    if (!isVisible(el) || isNotPasteBox(el)) return false;
    if (el instanceof HTMLInputElement) {
      return TEXTY_INPUT_TYPES.has(el.getAttribute("type") ?? "");
    }
    return true;
  });

  nlog(
    "source-input candidates:",
    all.map((el) => `${el.tagName.toLowerCase()}[${editorLabel(el).trim()}]`),
  );

  const labelled = all.filter((el) =>
    prefer.some((k) => editorLabel(el).includes(k)),
  );
  if (labelled[0]) return labelled[0];

  const inDialog = all.filter((el) =>
    el.closest('[role="dialog"], mat-dialog-container'),
  );
  const pool = inDialog.length ? inDialog : all;
  const empty = pool.filter(editorIsEmpty);
  const choose = empty.length ? empty : pool;

  choose.sort((a, b) => {
    const ra = a.getBoundingClientRect();
    const rb = b.getBoundingClientRect();
    return rb.width * rb.height - ra.width * ra.height;
  });
  return choose[0] ?? null;
}

async function waitForSourceBox(
  selectors: string[],
  prefer: string[],
  timeoutMs: number,
): Promise<HTMLElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    // Exact selectors first (known fields). When exact selectors are given we
    // wait for them ONLY — the heuristic would otherwise grab whatever field
    // loads first (e.g. the notebook-name input) before the real box appears.
    for (const sel of selectors) {
      const el = document.querySelector<HTMLElement>(sel);
      if (el && isVisible(el)) return el;
    }
    if (selectors.length === 0) {
      const box = findSourceBox(prefer);
      if (box) return box;
    }
    await sleep(200);
  }
  return null;
}

/**
 * Click the dialog's "Insert" submit button — waiting for it to become enabled,
 * since it stays disabled until the paste box registers content. Logs the
 * available buttons if it never enables, so a miss is diagnosable.
 */
async function clickInsert(timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  let everSeen = false;
  while (Date.now() < deadline) {
    const btns = Array.from(
      document.querySelectorAll<HTMLElement>('button, [role="button"]'),
    );
    const match = btns.find((b) => {
      const label = (b.getAttribute("aria-label") ?? b.textContent ?? "")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
      return label === "insert" || label.startsWith("insert");
    });
    if (match) {
      everSeen = true;
      const disabled =
        (match as HTMLButtonElement).disabled ||
        match.getAttribute("aria-disabled") === "true";
      if (!disabled) {
        match.click();
        return true;
      }
    }
    await sleep(250);
  }
  if (everSeen) nlog("Insert button stayed disabled");
  else
    nlog(
      "no Insert button; buttons seen:",
      Array.from(document.querySelectorAll("button"))
        .map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim())
        .filter(Boolean)
        .slice(0, 25),
    );
  return false;
}

/**
 * NotebookLM has no chat composer — sources are added through a dialog. Drive
 * it: open "Copied text", fill the paste box with the transcript, and submit.
 * Each step falls back to the clipboard if its element can't be found, so the
 * worst case is the pre-v0.1.17 manual behavior.
 */
const URL_RE = /^https?:\/\/\S+$/;

function boxValue(el: HTMLElement): string {
  return el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement
    ? el.value
    : (el.textContent ?? "");
}

function setNativeValue(el: HTMLElement, text: string): void {
  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    const proto =
      el instanceof HTMLTextAreaElement
        ? HTMLTextAreaElement.prototype
        : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    setter?.call(el, text);
  } else {
    el.textContent = text;
  }
}

/**
 * Robustly fill a (possibly framework-controlled) field, trying several
 * techniques and verifying the value took after each: execCommand, then
 * native-setter + InputEvent, then a synthetic paste. Returns whether it stuck.
 */
async function fillBox(el: HTMLElement, text: string): Promise<boolean> {
  const took = () => boxValue(el).includes(text.slice(0, 20));

  el.scrollIntoView?.({ block: "center" });
  el.click?.();
  el.focus();
  await sleep(120); // let the field's value accessor initialise

  if (el instanceof HTMLTextAreaElement || el instanceof HTMLInputElement) {
    el.select();
  }
  try {
    document.execCommand("insertText", false, text);
  } catch {
    /* deprecated in some contexts */
  }
  if (took()) return true;

  setNativeValue(el, text);
  el.dispatchEvent(
    new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }),
  );
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (took()) return true;

  try {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    el.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      }),
    );
  } catch {
    /* DataTransfer/ClipboardEvent unsupported */
  }
  return took();
}

/** Read the last visible response container's text content. */
function readLastResponse(responseSelectors: string[]): string {
  for (const sel of responseSelectors) {
    const all = document.querySelectorAll<HTMLElement>(sel);
    const last = all[all.length - 1];
    if (last) {
      const text = (last.innerText ?? last.textContent ?? "").trim();
      if (text.length > 20) return text;
    }
  }
  return "";
}

import { parseTldwBlock } from "../lib/tldw";

function hasStopButton(stopSelectors: string[]): boolean {
  return stopSelectors.some((sel) => {
    for (const el of document.querySelectorAll<HTMLElement>(sel)) {
      if (isVisible(el)) return true;
    }
    return false;
  });
}

/**
 * After the prompt is submitted, wait for the AI to finish generating, then
 * read the response and send it to the background so it can be forwarded to
 * the source YouTube tab. Times out after 3 minutes.
 */
async function waitForResponseAndSend(
  config: SiteConfig,
  sourceTabId: number,
): Promise<void> {
  log(`watching ${config.name} for the response (sourceTab ${sourceTabId})`);
  const deadline = Date.now() + 180_000;

  // Wait up to 15s for the stop button to appear (generation started).
  const startDeadline = Date.now() + 15_000;
  let sawStop = false;
  while (Date.now() < startDeadline) {
    if (hasStopButton(config.stopSelectors)) { sawStop = true; break; }
    await sleep(500);
  }
  log(sawStop ? "generation started (stop button seen)" : "no stop button seen in 15s — reading anyway");

  // Wait for the stop button to disappear (generation done).
  while (Date.now() < deadline) {
    if (!hasStopButton(config.stopSelectors)) break;
    await sleep(800);
  }

  // Give the DOM a moment to settle after the stop button disappears.
  await sleep(600);

  // Poll for the parseable ---TLDW--- block rather than reading once: the final
  // block can still be streaming in when the stop button vanishes, and stop-
  // button detection isn't perfect, so a single read can catch a partial answer.
  let tldw = null;
  let lastText = "";
  const readDeadline = Math.min(deadline, Date.now() + 25_000);
  while (Date.now() < readDeadline) {
    lastText = readLastResponse(config.responseSelectors);
    tldw = lastText ? parseTldwBlock(lastText) : null;
    if (tldw) break;
    await sleep(700);
  }

  if (tldw) {
    log("parsed TL;DW block — sending to YouTube tab");
    try {
      await chrome.runtime.sendMessage({ type: "AI_SUMMARY", tldw, sourceTabId });
    } catch {
      /* background may be asleep — best effort */
    }
    return;
  }

  // Couldn't find a structured block. Log what we DID read so the failure is
  // diagnosable, then fall back to showing the raw response so the user gets
  // *something* instead of a dead spinner.
  log(
    `no TL;DW block found. response selector matched ${lastText.length} chars.`,
    lastText ? `First 300:\n${lastText.slice(0, 300)}` : "(empty — response selector may be wrong)",
  );
  if (lastText.length > 80) {
    // No structured block, but the AI clearly answered — surface its first
    // substantive line as the summary and the rest as details, so the panel
    // shows something useful instead of a dead spinner.
    const firstLine =
      lastText
        .split("\n")
        .map((l) => l.replace(/^\s*[\d.)\-*#•]+\s*/, "").trim())
        .find((l) => l.length >= 40) ?? lastText.trim().slice(0, 200);
    const fallback = {
      summary: firstLine,
      details: lastText.slice(0, 4000),
    };
    try {
      await chrome.runtime.sendMessage({ type: "AI_SUMMARY", tldw: fallback, sourceTabId });
    } catch {
      /* best effort */
    }
  }
}

type Outcome = { ok: boolean; reason?: string };

/** Tell the background how the fill went, so the popup can surface failures. */
async function reportOutcome(site: string, outcome: Outcome): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "INJECT_RESULT",
      site,
      ok: outcome.ok,
      reason: outcome.reason,
    });
  } catch {
    /* background may be asleep mid-navigation; best effort */
  }
}

async function runNotebookLM(content: string): Promise<Outcome> {
  nlog("start");
  // 0. On the home page, create a new notebook. No fixed sleep — the next step
  //    polls for the dialog and fires the instant it's ready.
  const createBtn = await waitForClickableByText(
    ["create new notebook", "create new"],
    10000,
  );
  if (createBtn) {
    nlog("clicking Create new");
    createBtn.click();
  } else {
    nlog("no Create button — assuming a notebook is already open");
  }

  // A bare URL → add it via "Websites"; anything else → paste via "Copied text".
  const isLink = URL_RE.test(content.trim());
  const sourceBtnTexts = isLink ? ["websites", "website"] : ["copied text", "paste text"];
  const boxSelectors = isLink
    ? [
        'textarea[formcontrolname="urls"]',
        'textarea[aria-label="Enter URLs"]',
        'textarea[placeholder*="Paste any links" i]',
      ]
    : [];
  const boxPrefer = isLink ? ["url", "link", "website", "paste"] : ["paste"];
  nlog(isLink ? "link mode (Websites)" : "transcript mode (Copied text)");

  // 1. Open the chosen source type once the dialog appears.
  const sourceBtn = await waitForClickableByText(sourceBtnTexts, 12000);
  if (!sourceBtn) {
    nlog("source button not found:", sourceBtnTexts);
    await fallbackToClipboard(content, "NotebookLM");
    return { ok: false, reason: `couldn't find the "${sourceBtnTexts[0]}" source button` };
  }
  nlog("clicking source button");
  sourceBtn.click();

  // 2. Fill the input that appears (the visible, empty field in the dialog that
  //    isn't the "search the web" box).
  const box = await waitForSourceBox(boxSelectors, boxPrefer, 20000);
  if (!box) {
    nlog("source input not found");
    await fallbackToClipboard(content, "NotebookLM");
    return { ok: false, reason: "couldn't find the source input box" };
  }
  nlog(
    "filling source input; length:",
    content.length,
    "snippet:",
    JSON.stringify(content.slice(0, 80)),
  );
  // Retry: the field is often in the DOM a beat before its value accessor is
  // ready, so a single fill can silently no-op.
  let filled = false;
  for (let attempt = 1; attempt <= 6 && !filled; attempt++) {
    if (attempt > 1) await sleep(400);
    filled = await fillBox(box, content);
    nlog(`fill attempt ${attempt}: ${filled ? "stuck" : "empty"}`);
  }
  if (!filled) {
    await fallbackToClipboard(content, "NotebookLM");
    return { ok: false, reason: "found the source box but couldn't fill it" };
  }

  // 3. Submit the source — wait for "Insert" to enable after the fill registers.
  if (await clickInsert(8000)) {
    nlog("clicked Insert");
    return { ok: true };
  }
  showToast('TL;DW: source filled in — click "Insert" to add it.');
  return { ok: false, reason: 'filled the source box but couldn\'t click "Insert"' };
}

/**
 * Insert text via a synthetic paste ClipboardEvent. React (and most frameworks)
 * handle paste events through their own synthetic event system and will update
 * controlled-input state, enabling the send button — unlike execCommand or
 * setting textContent directly which React ignores for state purposes.
 */
async function pasteIntoEditor(editor: HTMLElement, text: string): Promise<boolean> {
  editor.focus();
  try {
    const range = document.createRange();
    range.selectNodeContents(editor);
    const sel = window.getSelection();
    if (sel) {
      sel.removeAllRanges();
      sel.addRange(range);
    }
  } catch { /* selection setup failed — paste will still try */ }
  try {
    const dt = new DataTransfer();
    dt.setData("text/plain", text);
    editor.dispatchEvent(
      new ClipboardEvent("paste", {
        bubbles: true,
        cancelable: true,
        clipboardData: dt,
      }),
    );
    await sleep(500);
    return (editor.textContent ?? "").includes(text.slice(0, 20));
  } catch {
    return false;
  }
}

/**
 * Activate the temporary/incognito chat mode for destinations that require a
 * UI click rather than a URL parameter. Claude and ChatGPT use incognito URLs
 * (handled by the background); Gemini needs a button click here.
 */
async function activateTemporaryMode(host: string): Promise<void> {
  if (host.endsWith("gemini.google.com")) {
    const btn = await waitFor<HTMLElement>(
      ['button[aria-label="Temporary chat"]', "temp-chat-button button"],
      6000,
    );
    if (btn) {
      btn.click();
      await sleep(600);
    }
  }
}

async function run(): Promise<void> {
  if (location.hostname.endsWith("notebooklm.google.com")) {
    const res = (await chrome.runtime.sendMessage({ type: "GET_PENDING" })) as {
      prompt: string | null;
    } | null;
    if (!res?.prompt) return;
    const outcome = await runNotebookLM(res.prompt);
    await reportOutcome("NotebookLM", outcome);
    return;
  }

  const config = configForHost(location.hostname);
  if (!config) return;

  const res = (await chrome.runtime.sendMessage({ type: "GET_PENDING" })) as {
    prompt: string | null;
    autoSubmit?: boolean;
    temporaryChats?: boolean;
    sourceTabId?: number;
  } | null;

  const prompt = res?.prompt;
  if (!prompt) { log(`${config.name}: no pending prompt for this tab`); return; }
  log(`${config.name}: pending prompt found (${prompt.length} chars, sourceTab ${res?.sourceTabId ?? "none"}, autoSubmit ${res?.autoSubmit !== false})`);
  if (res?.sourceTabId === undefined) {
    log("WARNING: no sourceTabId — the summary can't be sent back to the YouTube tab");
  }

  if (res?.temporaryChats) {
    await activateTemporaryMode(location.hostname);
  }

  // Generous ceiling: chat apps (ChatGPT/Claude) can render a splash and only
  // mount the composer after their client-side router resolves, which on a cold
  // load can land well past document_idle.
  const editor = await waitFor<HTMLElement>(config.editorSelectors, 20000);
  if (!editor) {
    await fallbackToClipboard(prompt, config.name);
    await reportOutcome(config.name, {
      ok: false,
      reason: "couldn't find the composer (its selectors may be out of date)",
    });
    return;
  }

  // Try execCommand / textContent approach first; fall back to ClipboardEvent paste.
  let inserted = insertText(editor, prompt);
  if (!inserted) {
    inserted = await pasteIntoEditor(editor, prompt);
  }
  if (!inserted) {
    // All in-page approaches failed — write to clipboard so user can Ctrl+V.
    await fallbackToClipboard(prompt, config.name);
    await reportOutcome(config.name, {
      ok: false,
      reason: "found the composer but couldn't type into it",
    });
    return;
  }

  // The prompt is in — report success now; submit is best-effort after this.
  await reportOutcome(config.name, { ok: true });

  if (res?.autoSubmit === false) {
    // Still watch for the response if the user submits manually.
    if (res.sourceTabId !== undefined) {
      void waitForResponseAndSend(config, res.sourceTabId);
    }
    return;
  }

  // Give React/Angular a moment to process the input event and enable the send button.
  await sleep(400);
  const btn = await findEnabledSendButton(config.sendSelectors, 6000);
  if (btn) {
    btn.click();
  } else {
    // Last resort: synthetic Enter. Dispatch the full keydown→keypress→keyup
    // sequence — some composers submit on keypress/keyup, and a lone keydown is
    // a no-op there.
    for (const type of ["keydown", "keypress", "keyup"] as const) {
      editor.dispatchEvent(
        new KeyboardEvent(type, {
          key: "Enter",
          code: "Enter",
          keyCode: 13,
          which: 13,
          bubbles: true,
          cancelable: true,
        }),
      );
    }
  }

  // After submit, wait for the AI to finish and forward the response.
  if (res?.sourceTabId !== undefined) {
    void waitForResponseAndSend(config, res.sourceTabId);
  }
}

void run();
