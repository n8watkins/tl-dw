/**
 * Auto-fill injector for chat destinations (Gemini, ChatGPT, Claude). On load
 * it asks the background worker whether this tab has a pending prompt; if so it
 * types the prompt into the site's composer and (optionally) submits. If the
 * composer can't be found or filled, it falls back to copying the prompt to the
 * clipboard and showing a toast so the user can paste it.
 *
 * Selectors are per-site and inherently brittle — when a site redesigns its
 * composer, add the new selector here. The clipboard fallback keeps the feature
 * usable in the meantime.
 */

type SiteConfig = {
  name: string;
  editorSelectors: string[];
  sendSelectors: string[];
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
    };
  }
  if (host.endsWith("chatgpt.com") || host.endsWith("chat.openai.com")) {
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
    };
  }
  return null;
}

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
  sendSelectors: string[],
  timeoutMs: number,
): Promise<HTMLButtonElement | null> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const sel of sendSelectors) {
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

async function fallbackToClipboard(prompt: string, site: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(prompt);
    showToast(`TL;DW: couldn't auto-fill ${site} — prompt copied, paste it (Ctrl+V) to send.`);
  } catch {
    showToast(`TL;DW: couldn't auto-fill ${site}. Open the popup to copy the prompt.`);
  }
}

async function run(): Promise<void> {
  const config = configForHost(location.hostname);
  if (!config) return;

  const res = (await chrome.runtime.sendMessage({ type: "GET_PENDING" })) as {
    prompt: string | null;
    autoSubmit?: boolean;
  } | null;

  const prompt = res?.prompt;
  if (!prompt) return;

  const editor = await waitFor<HTMLElement>(config.editorSelectors, 12000);
  if (!editor) {
    await fallbackToClipboard(prompt, config.name);
    return;
  }

  const inserted = insertText(editor, prompt);
  if (!inserted) {
    await fallbackToClipboard(prompt, config.name);
    return;
  }

  if (res?.autoSubmit === false) return; // user wants to review first

  await sleep(150);
  const btn = await findEnabledSendButton(config.sendSelectors, 3000);
  if (btn) {
    btn.click();
    return;
  }

  // Last resort: synthetic Enter.
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
