/**
 * Runs on gemini.google.com. On load it asks the background worker whether
 * this tab has a pending prompt; if so, it injects the text into Gemini's
 * composer and (optionally) submits. If injection fails, it falls back to
 * copying the prompt to the clipboard and showing a toast.
 *
 * The injection mechanism (execCommand insertText + click send) was validated
 * by hand before this was written — see spike-gemini.js.
 */

const EDITOR_SELECTORS = [
  'div.ql-editor[contenteditable="true"]',
  'rich-textarea div[contenteditable="true"]',
  'div[contenteditable="true"][role="textbox"]',
  'div[contenteditable="true"]',
  "textarea",
];

const SEND_SELECTORS = [
  'button[aria-label*="Send" i]',
  "button.send-button",
  'button[mattooltip*="Send" i]',
];

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitFor<T extends Element>(
  selectors: string[],
  timeoutMs: number,
): Promise<T | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of selectors) {
      const el = document.querySelector<T>(sel);
      if (el) return el;
    }
    await sleep(150);
  }
  return null;
}

function insertText(editor: Element, text: string): boolean {
  (editor as HTMLElement).focus();

  if (editor instanceof HTMLTextAreaElement) {
    const setter = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value",
    )?.set;
    setter?.call(editor, text);
    editor.dispatchEvent(new Event("input", { bubbles: true }));
    return editor.value === text;
  }

  let ok = false;
  try {
    ok = document.execCommand("insertText", false, text);
  } catch {
    ok = false;
  }
  if (!ok) {
    editor.textContent = text;
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
  timeoutMs: number,
): Promise<HTMLButtonElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of SEND_SELECTORS) {
      const btn = document.querySelector<HTMLButtonElement>(sel);
      if (
        btn &&
        !btn.disabled &&
        btn.getAttribute("aria-disabled") !== "true"
      ) {
        return btn;
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

async function fallbackToClipboard(prompt: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(prompt);
    showToast("TL;DW: couldn't auto-fill — prompt copied, paste it to send.");
  } catch {
    showToast("TL;DW: couldn't auto-fill Gemini. Open the popup to copy the prompt.");
  }
}

async function run(): Promise<void> {
  const res = (await chrome.runtime.sendMessage({ type: "GET_PENDING" })) as {
    prompt: string | null;
    autoSubmit?: boolean;
  } | null;

  const prompt = res?.prompt;
  if (!prompt) return;

  const editor = await waitFor<HTMLElement>(EDITOR_SELECTORS, 12000);
  if (!editor) {
    await fallbackToClipboard(prompt);
    return;
  }

  const inserted = insertText(editor, prompt);
  if (!inserted) {
    await fallbackToClipboard(prompt);
    return;
  }

  if (res?.autoSubmit === false) return; // user wants to review first

  await sleep(150);
  const btn = await findEnabledSendButton(3000);
  if (btn) {
    btn.click();
    return;
  }

  // Last resort: synthetic Enter, then clipboard if that fails too.
  editor.dispatchEvent(
    new KeyboardEvent("keydown", {
      key: "Enter",
      code: "Enter",
      keyCode: 13,
      bubbles: true,
    }),
  );
}

void run();
