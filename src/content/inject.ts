/**
 * Auto-fill injector for the Gemini web app (no-key mode). On load
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

import { COMPOSER_MISSING_REASON } from "../lib/fillFailure";
import { insertedShare, promptInsertedWhole } from "../lib/promptInsert";

/**
 * How TL;DW finds its way around a chat site. The send and stop buttons are
 * looked for only inside the composer (the box around the message editor):
 * signed in, these sites list recent chats in a sidebar, each with a menu
 * button labeled "More options for <chat title>", so a whole-page match on
 * "Stop" or "Send" also hit a chat called "Cannot Stop Paused Timer", and TL;DW
 * waited for a "generation" that never ended. Selectors match whole labels,
 * never a substring.
 */
type SiteConfig = {
  name: string;
  editorSelectors: string[];
  /** The composer around the editor, which holds the send and stop buttons. */
  composerSelectors: string[];
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
      composerSelectors: ["input-area-v2", "input-container", ".input-area-container", ".input-area", "fieldset", "form"],
      sendSelectors: [
        'button[aria-label="Send message" i]',
        'button.send-button:not(.stop)',
        'button[mattooltip="Send message" i]',
      ],
      stopSelectors: [
        'button[aria-label="Stop response" i]',
        'button[aria-label="Stop generating" i]',
        "button.send-button.stop",
      ],
      responseSelectors: [
        "model-response",
        ".response-container",
        "[data-response-index]",
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
    return promptInsertedWhole(editor.value, text);
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
  if (!ok || !promptInsertedWhole(editor.textContent ?? "", text)) {
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
  return promptInsertedWhole(editor.textContent ?? "", text);
}

/** The text a composer holds (a textarea's value or an editor's text). */
function composerText(editor: Element): string {
  return editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement
    ? editor.value
    : editor.textContent ?? "";
}

/** Empty a composer, so a cut-off prompt can't be sent by accident. */
function clearComposer(editor: Element): void {
  try {
    if (editor instanceof HTMLTextAreaElement || editor instanceof HTMLInputElement) {
      const proto =
        editor instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(editor, "");
    } else {
      editor.textContent = "";
    }
    editor.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "deleteContentBackward" }));
  } catch {
    /* best effort */
  }
}

/**
 * Page areas that list other chats (sidebars), never the composer. Only the
 * sidebar itself: Gemini wraps its whole app, composer included, in
 * side-navigation-v2 and bard-sidenav-container, with the sidebar in
 * bard-sidenav beside bard-sidenav-content.
 */
const NAVIGATION_AREAS = 'nav, aside, [role="navigation"], bard-sidenav';

/** How many levels above the editor to look for its composer when no selector matches. */
const COMPOSER_MAX_DEPTH = 6;

/**
 * The composer: the element around the message editor that holds its send
 * and stop buttons. Found from the editor itself, so a sidebar never counts.
 * Null when there's no editor.
 */
function composerRoot(config: SiteConfig): Element | null {
  const editor = config.editorSelectors
    .map((sel) => [...document.querySelectorAll<HTMLElement>(sel)].find((el) => !el.closest(NAVIGATION_AREAS)))
    .find(Boolean);
  if (!editor) return null;
  // In the config's order, not the nearest match: Gemini's editor sits in a
  // fieldset inside input-area-v2, and the outer element is the safer root.
  for (const sel of config.composerSelectors) {
    const known = editor.closest(sel);
    if (known && !known.closest(NAVIGATION_AREAS)) return known;
  }
  // Unknown markup: the nearest ancestor that also holds a button.
  let el: Element | null = editor.parentElement;
  for (let depth = 0; el && depth < COMPOSER_MAX_DEPTH; depth += 1, el = el.parentElement) {
    if (el.matches(NAVIGATION_AREAS)) break;
    if (el.querySelector("button")) return el;
  }
  return null;
}

/**
 * The visible buttons matching `selectors` inside the composer. Without a
 * composer, the whole page outside its sidebars (the selectors match whole
 * labels, so this is the fallback only).
 */
function composerButtons(config: SiteConfig, selectors: string[]): HTMLButtonElement[] {
  const root = composerRoot(config);
  return selectors.flatMap((sel) =>
    [...(root ?? document).querySelectorAll<HTMLButtonElement>(sel)].filter(
      (btn) => isVisible(btn) && (root || !btn.closest(NAVIGATION_AREAS)),
    ));
}

async function findEnabledSendButton(
  config: SiteConfig,
  timeoutMs: number,
): Promise<HTMLButtonElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const btn = composerButtons(config, config.sendSelectors)
      .find((b) => !b.disabled && b.getAttribute("aria-disabled") !== "true");
    if (btn) return btn;
    await sleep(120);
  }
  return null;
}

function createToast(): HTMLDivElement {
  const el = document.createElement("div");
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
  el.setAttribute("role", "status");
  el.dataset.tldwToast = "";
  return el;
}

function showToast(text: string, durationMs = 5000): void {
  const el = createToast();
  el.textContent = text;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), durationMs);
}

function toastButton(label: string, primary: boolean): HTMLButtonElement {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.textContent = label;
  Object.assign(btn.style, {
    padding: "4px 12px",
    borderRadius: "999px",
    border: primary ? "none" : "1px solid rgba(255,255,255,.35)",
    background: primary ? "#8ab4f8" : "transparent",
    color: primary ? "#1f2937" : "#fff",
    font: "600 13px/1.4 system-ui, sans-serif",
    cursor: "pointer",
    flexShrink: "0",
  });
  return btn;
}

/**
 * Put `text` on the clipboard. The async Clipboard API refuses a tab in the
 * background ("Document is not focused"), which is where a destination tab
 * usually is, so fall back to execCommand("copy"): the extension's
 * clipboardWrite permission lets a content script copy that way unfocused.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    /* not focused or blocked: try the other way */
  }
  const onCopy = (event: ClipboardEvent) => {
    if (!event.clipboardData) return;
    event.clipboardData.setData("text/plain", text);
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const holder = document.createElement("textarea");
  holder.value = text;
  holder.setAttribute("readonly", "");
  Object.assign(holder.style, { position: "fixed", top: "-1000px", opacity: "0" });
  document.body.appendChild(holder);
  window.addEventListener("copy", onCopy, true);
  try {
    holder.select();
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    window.removeEventListener("copy", onCopy, true);
    holder.remove();
  }
}

/**
 * A notice that stays until it's dismissed, with a button that copies the
 * prompt, for when TL;DW couldn't copy it on its own.
 */
function showCopyNotice(text: string, prompt: string): void {
  const el = createToast();
  Object.assign(el.style, { display: "flex", alignItems: "center", gap: "12px" });
  const msg = document.createElement("span");
  msg.textContent = text;
  const copyBtn = toastButton("Copy prompt", true);
  const closeBtn = toastButton("Dismiss", false);
  copyBtn.addEventListener("click", () => {
    void copyText(prompt).then((copied) => {
      if (!copied) {
        msg.textContent = "TL;DW: Chrome blocked the copy. Click the page, then try again.";
        return;
      }
      msg.textContent = "TL;DW: Copied. Paste it (Ctrl+V) to send.";
      copyBtn.remove();
      setTimeout(() => el.remove(), 8000);
    });
  });
  closeBtn.addEventListener("click", () => el.remove());
  el.append(msg, copyBtn, closeBtn);
  document.body.appendChild(el);
}

/**
 * Copy the prompt to the clipboard and say so on the page. `problem` names
 * what went wrong (default: the composer couldn't be filled). Returns whether
 * the prompt is on the clipboard; when it isn't, the notice stays up with a
 * button that copies it.
 */
async function fallbackToClipboard(prompt: string, site: string, problem?: string): Promise<boolean> {
  const what = problem ?? `couldn't auto-fill ${site}`;
  if (await copyText(prompt)) {
    showToast(`TL;DW: ${what}. The full prompt is copied: paste it (Ctrl+V) to send.`, 12000);
    return true;
  }
  showCopyNotice(`TL;DW: ${what}. Copy the full prompt, then paste it (Ctrl+V) to send.`, prompt);
  return false;
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

const log = (...args: unknown[]) => console.log("[TL;DW inject]", ...args);

/**
 * An element's rendered text with its list items marked ("- item", "1. item"):
 * a site renders the model's Markdown list as <li> elements, whose rendered
 * text loses the markers, and TL;DW shows DETAILS lists as lists.
 */
function textWithListMarkers(el: HTMLElement): string {
  if (!el.querySelector("li")) return el.innerText ?? el.textContent ?? "";
  const clone = el.cloneNode(true) as HTMLElement;
  for (const li of clone.querySelectorAll("li")) {
    const list = li.parentElement;
    const index = list ? [...list.children].filter((c) => c.tagName === "LI").indexOf(li) : 0;
    const marker = list?.tagName === "OL" ? `${index + 1}. ` : "- ";
    li.prepend(document.createTextNode(marker));
  }
  // innerText needs layout, so measure the clone off-screen.
  const holder = document.createElement("div");
  // Not visibility:hidden: innerText leaves out hidden text.
  holder.style.cssText = "position:fixed;left:-100000px;top:0;width:800px;opacity:0;pointer-events:none";
  holder.append(clone);
  document.body.append(holder);
  try {
    return clone.innerText ?? clone.textContent ?? "";
  } finally {
    holder.remove();
  }
}

/** Elements whose text never belongs to the answer. */
const SKIP_TAGS = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEMPLATE", "SVG", "BUTTON", "MAT-ICON", "TEXTAREA"]);
/** Elements that start and end a line of text. */
const BLOCK_TAGS = new Set([
  "P", "DIV", "LI", "UL", "OL", "H1", "H2", "H3", "H4", "H5", "H6", "PRE", "BLOCKQUOTE",
  "TABLE", "TR", "SECTION", "ARTICLE", "HEADER", "FOOTER", "DL", "DT", "DD", "FIGURE",
]);

/**
 * An element's text read from the DOM tree itself, with line breaks between
 * blocks and list items marked, whatever the CSS says. innerText leaves out
 * hidden text, and in a background tab Gemini keeps a finished answer's
 * paragraphs as `display: none` ("p.pending") until its reveal animation runs,
 * which only happens once the tab is shown. textContent has the words but runs
 * the paragraphs together, so this walks the tree instead.
 */
function structuralText(root: Element): string {
  const out: string[] = [];
  const walk = (node: Node, pre: boolean) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      out.push(pre ? text : text.replace(/\s+/g, " "));
      return;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return;
    const el = node as Element;
    const tag = el.tagName.toUpperCase();
    if (SKIP_TAGS.has(tag)) return;
    if (tag === "BR" || tag === "HR") { out.push("\n"); return; }
    const block = BLOCK_TAGS.has(tag);
    if (block) out.push("\n");
    if (tag === "LI") {
      const list = el.parentElement;
      const index = list ? [...list.children].filter((c) => c.tagName === "LI").indexOf(el) : 0;
      out.push(list?.tagName === "OL" ? `${index + 1}. ` : "- ");
    }
    for (const child of el.childNodes) walk(child, pre || tag === "PRE");
    if (block) out.push("\n");
  };
  walk(root, false);
  return out.join("")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** How many answers the chat shows (the first response selector that matches any). */
function responseCount(responseSelectors: string[]): number {
  for (const sel of responseSelectors) {
    const n = document.querySelectorAll(sel).length;
    if (n) return n;
  }
  return 0;
}

/** The last element matching the first response selector that has any. */
function lastResponseElement(responseSelectors: string[]): HTMLElement | null {
  for (const sel of responseSelectors) {
    const all = document.querySelectorAll<HTMLElement>(sel);
    if (all.length) return all[all.length - 1];
  }
  return null;
}

/** Read the last visible response container's text content. */
function readLastResponse(responseSelectors: string[]): string {
  for (const sel of responseSelectors) {
    const all = document.querySelectorAll<HTMLElement>(sel);
    const last = all[all.length - 1];
    if (last) {
      const text = textWithListMarkers(last).trim();
      if (text.length > 20) return text;
    }
  }
  return "";
}

type ResponseRead = {
  /** The answer's text, as best read. */
  text: string;
  tldw: ReturnType<typeof parseTldwBlock>;
  /** Whether it came from the DOM tree because the rendered text lacked it. */
  hidden: boolean;
};

/**
 * Read the last answer and parse its TL;DW block: from the rendered text when
 * that has it (what the user sees), else from the DOM tree, which also has
 * text the page keeps hidden (a background tab's unrevealed paragraphs).
 */
function readResponse(responseSelectors: string[], after = 0): ResponseRead {
  // Only an answer that came after our message counts (a long transcript's
  // parts each got an "OK" answer first).
  if (responseCount(responseSelectors) <= after) return { text: "", tldw: null, hidden: false };
  const rendered = readLastResponse(responseSelectors);
  const parsed = rendered ? parseTldwBlock(rendered) : null;
  if (parsed) return { text: rendered, tldw: parsed, hidden: false };
  const el = lastResponseElement(responseSelectors);
  const raw = el ? structuralText(el) : "";
  const fromTree = raw ? parseTldwBlock(raw) : null;
  if (fromTree) return { text: raw, tldw: fromTree, hidden: true };
  return { text: raw.length > rendered.length ? raw : rendered, tldw: null, hidden: raw.length > rendered.length };
}

import { parseTldwBlock } from "../lib/tldw";

/** Whether the composer shows the site's stop button (the AI is generating). */
function hasStopButton(config: SiteConfig): boolean {
  return composerButtons(config, config.stopSelectors).length > 0;
}

/**
 * How long a complete TL;DW block (closing marker included) must stay
 * unchanged before it is accepted even while a stop button still shows: the
 * answer itself is the stronger signal, so a stop control TL;DW misreads can't
 * hold a finished summary back until the deadline.
 */
const COMPLETE_BLOCK_STABLE_MS = 8000;

/**
 * How long a finished answer without a TL;DW block must stay unchanged before
 * TL;DW gives up on the block and shows the raw answer (never cached). Long
 * enough for a block still rendering after the stop button goes, short enough
 * that the page's own run hasn't timed out by then.
 */
const NO_BLOCK_GIVE_UP_MS = 8000;

/**
 * After the prompt is submitted, wait for the AI to finish generating, then
 * read the response and send it to the background so it can be forwarded to
 * the source YouTube tab. Times out after 3 minutes.
 */
async function waitForResponseAndSend(
  config: SiteConfig,
  sourceTabId: number,
  signedIn = false,
  after = 0,
): Promise<void> {
  log(`watching ${config.name} for the response (sourceTab ${sourceTabId})`);
  const deadline = Date.now() + 180_000;

  // Wait up to 15s for the stop button to appear (generation started).
  const startDeadline = Date.now() + 15_000;
  let sawStop = false;
  while (Date.now() < startDeadline) {
    if (hasStopButton(config)) { sawStop = true; break; }
    await sleep(500);
  }
  log(sawStop ? "generation started (stop button seen)" : "no stop button seen in 15s — reading anyway");

  // Then poll until the answer is complete: generation has stopped and the
  // TL;DW block has stopped changing (the block can still be
  // streaming when the stop button vanishes, and stop-button detection isn't
  // perfect). Keep reading until the deadline rather than for a fixed time
  // after the stop button goes: in a background tab Chrome throttles timers
  // and the page renders lazily, so the answer can take longer to appear.
  // Give up early only when generation has stopped and the text hasn't changed
  // for a while without a block, and fall back to the raw text then.
  let tldw: ReturnType<typeof parseTldwBlock> = null;
  let lastText = "";
  let previous = "";
  let stableSince = Date.now();
  let hidden = false;
  let answer = "";
  while (Date.now() < deadline) {
    const generating = hasStopButton(config);
    const read = readResponse(config.responseSelectors, after);
    if (read.text !== previous) { previous = read.text; stableSince = Date.now(); }
    lastText = read.text;
    hidden = read.hidden;
    const stableFor = Date.now() - stableSince;
    const complete = !!read.tldw && /END\s+TLDW/i.test(read.text);
    const settled = (!generating && stableFor >= 600) || (complete && stableFor >= COMPLETE_BLOCK_STABLE_MS);
    if (read.tldw && settled) { tldw = read.tldw; answer = read.text; break; }
    if (!generating && !read.tldw && lastText && Date.now() - stableSince >= NO_BLOCK_GIVE_UP_MS) break;
    await sleep(700);
  }
  if (tldw && hidden) log("read the answer from the page's hidden text (background tab)");

  if (tldw) {
    log("parsed TL;DW block — sending to YouTube tab");
    try {
      await chrome.runtime.sendMessage({ type: "AI_SUMMARY", tldw, raw: answer, sourceTabId, signedIn, parsed: true });
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
  // Gemini said it couldn't open the linked video (signed out, or captions it
  // couldn't read): the page says so instead of showing a guess.
  if (lastText.length < 300 && /\bCANNOT[ _]ACCESS\b/i.test(lastText)) {
    try {
      await chrome.runtime.sendMessage({
        type: "AI_SUMMARY", tldw: { summary: "" }, sourceTabId, signedIn, parsed: false, cannotAccess: true,
      });
    } catch { /* best effort */ }
    return;
  }
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
      await chrome.runtime.sendMessage({ type: "AI_SUMMARY", tldw: fallback, sourceTabId, signedIn, parsed: false });
    } catch {
      /* best effort */
    }
  }
}

type Outcome = { ok: boolean; reason?: string; keptPercent?: number; copied?: boolean };

/** Tell the background how the fill went, so the popup can surface failures. */
async function reportOutcome(site: string, outcome: Outcome): Promise<void> {
  try {
    await chrome.runtime.sendMessage({
      type: "INJECT_RESULT",
      site,
      ok: outcome.ok,
      reason: outcome.reason,
      keptPercent: outcome.keptPercent,
      copied: outcome.copied,
    });
  } catch {
    /* background may be asleep mid-navigation; best effort */
  }
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
    return promptInsertedWhole(editor.textContent ?? "", text);
  } catch {
    return false;
  }
}

/**
 * Turn on Gemini's temporary chat (it has no URL parameter, so this clicks its
 * button), so the chat isn't saved to the user's Gemini history.
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

/** Google's account button: present only when signed in. */
const SIGNED_IN_SELECTORS = [
  'a[aria-label^="Google Account" i]',
  'a[href*="accounts.google.com/SignOutOptions"]',
];
/** Sign-in links and buttons: present only when signed out. */
const SIGNED_OUT_SELECTORS = [
  'a[href*="accounts.google.com/ServiceLogin"]',
  'a[href*="accounts.google.com/v3/signin"]',
  'a[href*="accounts.google.com/AccountChooser"]',
];

/**
 * Whether the Gemini page shows a signed-in Google account: "out" as soon as
 * a sign-in link or button shows, "in" when Google's account button does and
 * no sign-in control, and "unknown" when neither shows within the wait.
 */
async function geminiAccount(timeoutMs = 4000): Promise<"in" | "out" | "unknown"> {
  const signedOut = () =>
    SIGNED_OUT_SELECTORS.some((sel) => document.querySelector(sel)) ||
    [...document.querySelectorAll<HTMLElement>("a, button")].some((el) => /^\s*sign in\s*$/i.test(el.textContent ?? ""));
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (signedOut()) return "out";
    if (SIGNED_IN_SELECTORS.some((sel) => document.querySelector(sel))) return signedOut() ? "out" : "in";
    await sleep(250);
  }
  return "unknown";
}

type Filled = { editor: HTMLElement } | { failed: Outcome };

/** Type `text` into the composer (finding it afresh: the app re-renders it). */
async function fill(config: SiteConfig, text: string, timeoutMs: number): Promise<Filled> {
  // Generous ceiling: the chat app can render a splash and only mount the
  // composer after its client-side router resolves, which on a cold load can
  // land well past document_idle.
  const editor = await waitFor<HTMLElement>(config.editorSelectors, timeoutMs);
  if (!editor) {
    const copied = await fallbackToClipboard(
      text,
      config.name,
      `couldn't find ${config.name}'s message box. If you're signed out, sign in first`,
    );
    return { failed: { ok: false, reason: COMPOSER_MISSING_REASON, copied } };
  }
  // Try execCommand / textContent approach first; fall back to ClipboardEvent paste.
  let inserted = insertText(editor, text);
  if (!inserted) inserted = await pasteIntoEditor(editor, text);
  if (inserted) return { editor };
  // A composer holding only part of the text means the site cut it short (a
  // length limit): say so, and empty it so the partial prompt (missing the
  // transcript's end) can't be sent by accident.
  const share = insertedShare(composerText(editor), text);
  const cutShort = share > 0;
  if (cutShort) clearComposer(editor);
  const pct = Math.round(share * 100);
  const copied = await fallbackToClipboard(
    text,
    config.name,
    cutShort ? `${config.name} cut the prompt off (it kept about ${pct}%)` : undefined,
  );
  return {
    failed: {
      ok: false,
      reason: cutShort
        ? `cut the prompt off at about ${pct}% because it was too long, so nothing was sent`
        : "wouldn't take the prompt TL;DW typed into its message box",
      keptPercent: cutShort ? pct : undefined,
      copied,
    },
  };
}

/** Press Send, or, failing that, Enter in the editor. */
async function submit(config: SiteConfig, editor: HTMLElement): Promise<void> {
  // Give the app a moment to process the input and enable the send button.
  await sleep(400);
  const btn = await findEnabledSendButton(config, 6000);
  if (btn) {
    btn.click();
    return;
  }
  // Last resort: the full keydown→keypress→keyup sequence; some composers
  // submit on keypress/keyup, and a lone keydown is a no-op there.
  for (const type of ["keydown", "keypress", "keyup"] as const) {
    editor.dispatchEvent(new KeyboardEvent(type, {
      key: "Enter", code: "Enter", keyCode: 13, which: 13, bubbles: true, cancelable: true,
    }));
  }
}

/** How long Gemini gets to acknowledge one part of a long transcript. */
const PART_ANSWER_MS = 90_000;

/** Wait for Gemini's answer to the message just sent (a part's acknowledgement). */
async function waitForAnswer(config: SiteConfig, after: number): Promise<boolean> {
  const deadline = Date.now() + PART_ANSWER_MS;
  let previous = "";
  let stableSince = Date.now();
  while (Date.now() < deadline) {
    await sleep(500);
    if (responseCount(config.responseSelectors) <= after) continue;
    const el = lastResponseElement(config.responseSelectors);
    const text = el ? structuralText(el) : "";
    if (text !== previous) { previous = text; stableSince = Date.now(); }
    if (text && !hasStopButton(config) && Date.now() - stableSince >= 800) return true;
  }
  return false;
}

async function progressStep(step: string): Promise<void> {
  try {
    await chrome.runtime.sendMessage({ type: "TAB_PROGRESS", step });
  } catch { /* best effort */ }
}

async function run(): Promise<void> {
  const config = configForHost(location.hostname);
  if (!config) return;

  const res = (await chrome.runtime.sendMessage({ type: "GET_PENDING" })) as {
    prompt: string | null;
    parts?: string[];
    requireSignIn?: boolean;
    autoSubmit?: boolean;
    temporaryChats?: boolean;
    sourceTabId?: number;
  } | null;

  const prompt = res?.prompt;
  if (!prompt) { log(`${config.name}: no pending prompt for this tab`); return; }
  const parts = res?.parts ?? [];
  log(`${config.name}: pending prompt found (${prompt.length} chars, ${parts.length} transcript parts first, sourceTab ${res?.sourceTabId ?? "none"}, autoSubmit ${res?.autoSubmit !== false})`);

  // Without a transcript, Gemini gets the video's link, which only a
  // signed-in Gemini can read. Signed out, say so instead of sending: the
  // signed-out answer would be a guess. When unsure, send: the prompt lets
  // Gemini answer CANNOT_ACCESS, and the page says the same then.
  const account = res?.requireSignIn ? await geminiAccount() : "unknown";
  if (res?.requireSignIn) log(`Gemini account: ${account}`);
  if (res?.requireSignIn && account === "out") {
    try {
      await chrome.runtime.sendMessage({ type: "INJECT_RESULT", site: config.name, ok: false, signInNeeded: true });
    } catch { /* best effort */ }
    return;
  }

  if (res?.temporaryChats) await activateTemporaryMode(location.hostname);

  // A long transcript goes first, part by part, each acknowledged before the next.
  for (let i = 0; i < parts.length; i++) {
    void progressStep(`Sending the transcript to Gemini, part ${i + 1} of ${parts.length}…`);
    const before = responseCount(config.responseSelectors);
    const filled = await fill(config, parts[i]!, i === 0 ? 20000 : 10000);
    if ("failed" in filled) {
      await reportOutcome(config.name, filled.failed);
      return;
    }
    await submit(config, filled.editor);
    if (!(await waitForAnswer(config, before))) {
      await reportOutcome(config.name, { ok: false, reason: `didn't answer part ${i + 1} of the transcript in time` });
      return;
    }
  }

  const before = responseCount(config.responseSelectors);
  const filled = await fill(config, prompt, parts.length ? 10000 : 20000);
  if ("failed" in filled) {
    await reportOutcome(config.name, filled.failed);
    return;
  }
  // The prompt is in — report success now; submit is best-effort after this.
  await reportOutcome(config.name, { ok: true });
  if (parts.length) void progressStep("Waiting for Gemini's answer…");

  // With the parts already sent, the request must go too; otherwise auto-submit
  // off lets the user press Send, and TL;DW still watches for the answer.
  if (res?.autoSubmit !== false || parts.length) await submit(config, filled.editor);
  if (res?.sourceTabId !== undefined) {
    void waitForResponseAndSend(config, res.sourceTabId, account === "in", before);
  }
}

void run();
