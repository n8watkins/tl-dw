/**
 * The on-page TL;DW panel's building blocks: theme, icons, header with its "⋯"
 * menu, and the summary body each layout draws. Pure DOM, no chrome.* calls:
 * youtube.ts owns the state and passes in what to show and what each action does.
 *
 * Every color pair here meets WCAG AA (4.5:1 for text) on the panel's own
 * background, in YouTube's light and dark themes; the e2e suite checks it with axe.
 */
import { formatClock } from "../lib/timedTranscript";
import type { SummaryItem, TldwSummary } from "../types";

export type PanelTheme = {
  dark: boolean;
  bg: string;
  border: string;
  text: string;
  sub: string;
  hover: string;
  link: string;
  /** The quiet fill behind time chips and cards. */
  chip: string;
  focus: string;
};

/** YouTube's own palette, light or dark, as the page currently shows it. */
export function panelTheme(): PanelTheme {
  const dark = document.documentElement.hasAttribute("dark");
  return dark
    ? { dark, bg: "#212121", border: "#3f3f3f", text: "#f1f1f1", sub: "#aaaaaa", hover: "#383838", link: "#3ea6ff", chip: "#2c2c2c", focus: "#3ea6ff" }
    : { dark, bg: "#ffffff", border: "#e5e5e5", text: "#0f0f0f", sub: "#606060", hover: "#f2f2f2", link: "#065fd4", chip: "#f2f2f2", focus: "#065fd4" };
}

// --- icons ---------------------------------------------------------------

const ICON_PATHS: Record<string, string> = {
  more: '<circle cx="5" cy="12" r="1.6"/><circle cx="12" cy="12" r="1.6"/><circle cx="19" cy="12" r="1.6"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  regenerate: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
  copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h8"/>',
  external: '<path d="M14 4h6v6"/><path d="M20 4l-9 9"/><path d="M19 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h4"/>',
  auto: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8"/><path d="M20 4v4h-4"/><path d="M20 12a8 8 0 0 1-13.7 5.7L4 16"/><path d="M4 20v-4h4"/>',
  settings: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  play: '<path d="M8 5.5v13l10-6.5z"/>',
  transcript: '<path d="M5 5h14M5 10h14M5 15h9M5 20h6"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="M10 9.5v5l4.5-2.5z"/>',
  saved: '<path d="M6 3h12v18l-6-4-6 4z"/>',
  key: '<circle cx="8" cy="15" r="4"/><path d="M11 12l9-9M17 6l3 3M15 8l2 2"/>',
  tab: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 9h18M8 4v5"/>',
  style: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>',
  signin: '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l4-4-4-4"/><path d="M14 12H4"/>',
  warning: '<path d="M12 4l9 16H3z"/><path d="M12 10v4M12 17v.01"/>',
  skip: '<path d="M5 5l9 7-9 7z"/><path d="M18 5v14"/>',
};

/** A 16 px line icon in the current text color, hidden from screen readers. */
export function icon(name: keyof typeof ICON_PATHS | string, size = 16): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("width", String(size));
  svg.setAttribute("height", String(size));
  svg.setAttribute("fill", name === "more" || name === "play" ? "currentColor" : "none");
  svg.setAttribute("stroke", name === "more" || name === "play" ? "none" : "currentColor");
  svg.setAttribute("stroke-width", "2");
  svg.setAttribute("stroke-linecap", "round");
  svg.setAttribute("stroke-linejoin", "round");
  svg.setAttribute("aria-hidden", "true");
  svg.style.flexShrink = "0";
  // Static, TL;DW-owned markup: no page or model text ever reaches it.
  svg.innerHTML = ICON_PATHS[name] ?? "";
  return svg;
}

// --- shared pieces -----------------------------------------------------------

/** The focus ring every TL;DW control shows for keyboard users. */
export function focusRing(el: HTMLElement, t: PanelTheme): void {
  el.addEventListener("focus", () => {
    if (el.matches(":focus-visible")) el.style.boxShadow = `0 0 0 2px ${t.bg}, 0 0 0 4px ${t.focus}`;
  });
  el.addEventListener("blur", () => { el.style.boxShadow = ""; });
}

/** A round icon-only button (⋯, ✕) with a visible label for screen readers. */
export function iconButton(t: PanelTheme, name: string, label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.setAttribute("aria-label", label);
  b.title = label;
  Object.assign(b.style, {
    display: "inline-flex", alignItems: "center", justifyContent: "center",
    width: "32px", height: "32px", padding: "0", border: "none", borderRadius: "50%",
    background: "transparent", color: t.sub, cursor: "pointer", flexShrink: "0", outline: "none",
  });
  b.append(icon(name, 18));
  b.addEventListener("mouseenter", () => { b.style.background = t.hover; b.style.color = t.text; });
  b.addEventListener("mouseleave", () => { b.style.background = "transparent"; b.style.color = t.sub; });
  b.addEventListener("click", (e) => { e.stopPropagation(); onClick(); });
  focusRing(b, t);
  return b;
}

/** A labeled pill button for the error and choice panels. */
export function pillButton(
  t: PanelTheme,
  label: string,
  opts: { icon?: string; primary?: boolean; title?: string; onClick: () => void },
): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  if (opts.title) b.title = opts.title;
  // Primary: white on YouTube blue (#065fd4 / 5.9:1); the dark theme uses the
  // lighter blue with near-black text (#3ea6ff on #0f0f0f / 7.9:1).
  const primaryBg = t.dark ? "#3ea6ff" : "#065fd4";
  const primaryFg = t.dark ? "#0f0f0f" : "#ffffff";
  Object.assign(b.style, {
    display: "inline-flex", alignItems: "center", gap: "6px", height: "34px",
    padding: "0 14px", borderRadius: "999px", cursor: "pointer", outline: "none",
    font: "500 14px/1 Roboto, system-ui, sans-serif",
    border: opts.primary ? "none" : `1px solid ${t.border}`,
    background: opts.primary ? primaryBg : "transparent",
    color: opts.primary ? primaryFg : t.text,
  });
  if (opts.icon) b.append(icon(opts.icon, 16));
  b.append(label);
  b.addEventListener("mouseenter", () => { b.style.filter = "brightness(0.95)"; if (!opts.primary) b.style.background = t.hover; });
  b.addEventListener("mouseleave", () => { b.style.filter = ""; if (!opts.primary) b.style.background = "transparent"; });
  b.addEventListener("click", (e) => { e.stopPropagation(); opts.onClick(); });
  focusRing(b, t);
  return b;
}

// --- the ⋯ menu ----------------------------------------------------------------

export type MenuEntry =
  | { kind: "item"; label: string; icon: string; detail?: string; title?: string; onClick: () => void }
  | { kind: "radio"; label: string; checked: boolean; onClick: () => void }
  | { kind: "heading"; label: string }
  | { kind: "separator" };

/**
 * The "⋯" button and its menu: a real menu (role="menu"), opened by click,
 * Enter or Space, moved through with the arrow keys and closed by Esc, a
 * click outside, or picking an item (focus returns to "⋯"). Teardown goes on
 * `cleanups` so a panel rebuild never leaks document listeners.
 */
export function overflowMenu(t: PanelTheme, entries: () => MenuEntry[], cleanups: Array<() => void>): HTMLElement {
  const wrap = document.createElement("span");
  Object.assign(wrap.style, { position: "relative", display: "inline-flex", flexShrink: "0" });
  const menuId = `tldw-menu-${Math.random().toString(36).slice(2, 8)}`;
  const menu = document.createElement("div");
  menu.id = menuId;
  menu.setAttribute("role", "menu");
  menu.setAttribute("aria-label", "TL;DW actions");
  Object.assign(menu.style, {
    position: "absolute", top: "calc(100% + 4px)", right: "0", minWidth: "250px", maxWidth: "320px",
    background: t.bg, border: `1px solid ${t.border}`, borderRadius: "12px",
    boxShadow: t.dark ? "0 8px 28px rgba(0,0,0,0.6)" : "0 8px 28px rgba(0,0,0,0.16)",
    padding: "6px 0", zIndex: "2147483000", display: "none", flexDirection: "column",
    font: "400 14px/1.4 Roboto, system-ui, sans-serif", color: t.text, textAlign: "left",
  });
  menu.addEventListener("click", (e) => e.stopPropagation());

  let open = false;
  let armTimer: number | undefined;
  const items = () => [...menu.querySelectorAll<HTMLElement>("[role^=menuitem]")];
  const onDocClick = (e: MouseEvent) => { if (!wrap.contains(e.target as Node)) close(false); };
  const onKey = (e: KeyboardEvent) => {
    if (!open) return;
    const list = items();
    const at = list.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); close(true); }
    else if (e.key === "ArrowDown") { e.preventDefault(); list[(at + 1) % list.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); list[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); list[list.length - 1]?.focus(); }
    else if (e.key === "Tab") close(false);
  };

  const trigger = iconButton(t, "more", "More actions", () => (open ? close(true) : show(false)));
  trigger.setAttribute("aria-haspopup", "menu");
  trigger.setAttribute("aria-expanded", "false");
  trigger.setAttribute("aria-controls", menuId);
  trigger.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown" || e.key === "Enter" || e.key === " ") { e.preventDefault(); show(true); }
  });

  function render(): void {
    menu.replaceChildren();
    for (const entry of entries()) {
      if (entry.kind === "separator") {
        const hr = document.createElement("div");
        hr.setAttribute("role", "separator");
        Object.assign(hr.style, { height: "1px", background: t.border, margin: "6px 0" });
        menu.append(hr);
        continue;
      }
      if (entry.kind === "heading") {
        const h = document.createElement("div");
        h.setAttribute("role", "presentation");
        h.textContent = entry.label;
        Object.assign(h.style, { padding: "6px 16px 2px", font: "500 12px/1.4 Roboto, system-ui, sans-serif", color: t.sub });
        menu.append(h);
        continue;
      }
      const b = document.createElement("button");
      b.type = "button";
      b.tabIndex = -1;
      Object.assign(b.style, {
        display: "flex", alignItems: "center", gap: "12px", width: "100%", minHeight: "36px",
        padding: "0 16px", border: "none", background: "transparent", color: t.text,
        cursor: "pointer", textAlign: "left", font: "inherit", outline: "none",
      });
      const label = document.createElement("span");
      label.textContent = entry.label;
      label.style.flex = "1";
      if (entry.kind === "radio") {
        b.setAttribute("role", "menuitemradio");
        b.setAttribute("aria-checked", String(entry.checked));
        const mark = icon("check", 16);
        mark.style.visibility = entry.checked ? "visible" : "hidden";
        b.append(mark, label);
      } else {
        b.setAttribute("role", "menuitem");
        if (entry.title) b.title = entry.title;
        b.append(icon(entry.icon, 18), label);
        if (entry.detail) {
          const d = document.createElement("span");
          d.textContent = entry.detail;
          d.style.color = t.sub;
          b.append(d);
        }
      }
      const hoverOn = () => { b.style.background = t.hover; };
      const hoverOff = () => { b.style.background = "transparent"; };
      b.addEventListener("mouseenter", hoverOn);
      b.addEventListener("mouseleave", hoverOff);
      b.addEventListener("focus", hoverOn);
      b.addEventListener("blur", hoverOff);
      b.addEventListener("click", (e) => { e.stopPropagation(); close(true); entry.onClick(); });
      menu.append(b);
    }
  }

  function show(focusFirst: boolean): void {
    render();
    open = true;
    menu.style.display = "flex";
    trigger.setAttribute("aria-expanded", "true");
    if (focusFirst) items()[0]?.focus();
    // Arm the outside click after this click finishes, or it would close at once.
    armTimer = window.setTimeout(() => {
      armTimer = undefined;
      if (!open) return;
      document.addEventListener("click", onDocClick, true);
    }, 0);
    document.addEventListener("keydown", onKey, true);
  }
  function close(returnFocus: boolean): void {
    if (!open) return;
    open = false;
    menu.style.display = "none";
    trigger.setAttribute("aria-expanded", "false");
    if (armTimer !== undefined) { clearTimeout(armTimer); armTimer = undefined; }
    document.removeEventListener("click", onDocClick, true);
    document.removeEventListener("keydown", onKey, true);
    if (returnFocus) trigger.focus();
  }
  cleanups.push(() => close(false));
  wrap.append(trigger, menu);
  return wrap;
}

// --- header --------------------------------------------------------------------

/**
 * The header every panel shares: logo, "TL;DW", a quiet subtitle (the style
 * and how it ran), then the "⋯" menu (when given) and close.
 */
export function panelHeader(
  t: PanelTheme,
  opts: { logoUrl: string; subtitle?: string; menu?: HTMLElement; onClose: () => void },
): HTMLElement {
  const head = document.createElement("div");
  head.dataset.tldwHead = "1";
  Object.assign(head.style, { display: "flex", alignItems: "center", gap: "8px", minHeight: "32px" });

  const logo = document.createElement("img");
  logo.src = opts.logoUrl;
  logo.alt = "";
  Object.assign(logo.style, { width: "22px", height: "22px", borderRadius: "6px", flexShrink: "0" });

  const name = document.createElement("span");
  name.textContent = "TL;DW";
  Object.assign(name.style, { font: "700 14px/1.3 Roboto, system-ui, sans-serif", color: t.text, flexShrink: "0" });

  const title = document.createElement("div");
  Object.assign(title.style, { display: "flex", alignItems: "baseline", gap: "6px", minWidth: "0", flex: "1" });
  title.append(name);
  if (opts.subtitle) {
    const sub = document.createElement("span");
    sub.dataset.tldwSubtitle = "1";
    sub.textContent = `· ${opts.subtitle}`;
    Object.assign(sub.style, {
      font: "400 13px/1.3 Roboto, system-ui, sans-serif", color: t.sub,
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: "0",
    });
    title.append(sub);
  }

  head.append(logo, title);
  if (opts.menu) head.append(opts.menu);
  head.append(iconButton(t, "close", "Hide TL;DW", opts.onClose));
  return head;
}

// --- body ------------------------------------------------------------------------

/** Plain text from a model's Markdown: drop **bold**, _emphasis_ and `code` marks. */
export function plainMarkdown(text: string): string {
  return text
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:!?]|$)/g, "$1$2")
    .replace(/`([^`]+)`/g, "$1")
    .trim();
}

/** A time that seeks the video: "2:36", in YouTube's link blue. */
function timeLink(t: PanelTheme, seconds: number, onSeek: (s: number) => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.dataset.tldwTime = String(seconds);
  const clock = formatClock(seconds);
  b.textContent = clock;
  b.setAttribute("aria-label", `Play from ${clock}`);
  Object.assign(b.style, {
    flexShrink: "0", minWidth: "44px", height: "22px", padding: "0 6px", marginRight: "10px",
    border: "none", borderRadius: "6px", background: t.chip, color: t.link, cursor: "pointer",
    font: "500 12px/22px Roboto, system-ui, sans-serif", fontVariantNumeric: "tabular-nums", outline: "none",
  });
  b.addEventListener("mouseenter", () => { b.style.textDecoration = "underline"; });
  b.addEventListener("mouseleave", () => { b.style.textDecoration = "none"; });
  b.addEventListener("click", (e) => { e.stopPropagation(); onSeek(seconds); });
  focusRing(b, t);
  return b;
}

/** Research: how the video backs a claim, as a small colored label. */
function statusTag(t: PanelTheme, tag: string): HTMLElement {
  const key = tag.toLowerCase();
  // [text, background] pairs, each at least 4.5:1.
  const palette: Record<string, [string, string]> = t.dark
    ? { shown: ["#81c995", "#1e3326"], stated: ["#cccccc", "#333333"], opinion: ["#fdd663", "#3a321c"], check: ["#d7aefb", "#33264a"] }
    : { shown: ["#0d652d", "#e6f4ea"], stated: ["#3c4043", "#f1f3f4"], opinion: ["#8a4f00", "#fef3e0"], check: ["#6b21a8", "#f3e8ff"] };
  const kind = key.startsWith("shown") ? "shown" : key.startsWith("opinion") ? "opinion" : key.startsWith("check") || key.startsWith("verify") ? "check" : "stated";
  const [fg, bg] = palette[kind]!;
  const el = document.createElement("span");
  el.dataset.tldwTag = kind;
  el.textContent = tag;
  Object.assign(el.style, {
    display: "inline-block", marginLeft: "8px", padding: "1px 8px", borderRadius: "999px",
    background: bg, color: fg, font: "500 12px/18px Roboto, system-ui, sans-serif", verticalAlign: "1px",
  });
  return el;
}

function row(t: PanelTheme, item: SummaryItem, onSeek: (s: number) => void, lead?: HTMLElement): HTMLElement {
  const li = document.createElement("li");
  Object.assign(li.style, { display: "flex", alignItems: "flex-start", padding: "4px 0", listStyle: "none" });
  if (item.time !== undefined) li.append(timeLink(t, item.time, onSeek));
  else if (lead) li.append(lead);
  else {
    const dot = document.createElement("span");
    dot.setAttribute("aria-hidden", "true");
    dot.textContent = "•";
    Object.assign(dot.style, { color: t.sub, width: "16px", flexShrink: "0", lineHeight: "22px" });
    li.append(dot);
  }
  const text = document.createElement("span");
  Object.assign(text.style, { flex: "1", minWidth: "0", font: "400 14px/22px Roboto, system-ui, sans-serif", color: t.text });
  text.append(plainMarkdown(item.text));
  if (item.tag) text.append(statusTag(t, plainMarkdown(item.tag)));
  li.append(text);
  return li;
}

function list(ordered: boolean): HTMLOListElement | HTMLUListElement {
  const el = document.createElement(ordered ? "ol" : "ul");
  Object.assign(el.style, { margin: "8px 0 0", padding: "0" });
  return el;
}

function note(t: PanelTheme, text: string): HTMLElement {
  const p = document.createElement("p");
  p.dataset.tldwNote = "1";
  Object.assign(p.style, { margin: "10px 0 0", font: "400 13px/1.5 Roboto, system-ui, sans-serif", color: t.sub });
  const m = plainMarkdown(text).match(/^([^:]{2,24}):\s*(.+)$/);
  if (m) {
    const b = document.createElement("strong");
    b.textContent = `${m[1]}:`;
    Object.assign(b.style, { fontWeight: "500", color: t.text });
    p.append(b, ` ${m[2]}`);
  } else p.append(plainMarkdown(text));
  return p;
}

/** Tutorial: a step number in a circle. */
function stepNumber(t: PanelTheme, n: number): HTMLElement {
  const el = document.createElement("span");
  el.setAttribute("aria-hidden", "true");
  el.textContent = String(n);
  Object.assign(el.style, {
    flexShrink: "0", width: "22px", height: "22px", marginRight: "10px", borderRadius: "50%",
    background: t.chip, color: t.text, textAlign: "center", font: "500 12px/22px Roboto, system-ui, sans-serif",
  });
  return el;
}

/** Learning: the key ideas as cards, two across when there's room. */
function ideaCards(t: PanelTheme, items: SummaryItem[], onSeek: (s: number) => void): HTMLElement {
  const grid = document.createElement("ul");
  Object.assign(grid.style, {
    display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))", gap: "8px",
    margin: "10px 0 0", padding: "0", listStyle: "none",
  });
  for (const item of items) {
    const card = document.createElement("li");
    Object.assign(card.style, { background: t.chip, borderRadius: "10px", padding: "10px 12px" });
    const top = document.createElement("div");
    Object.assign(top.style, { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "8px" });
    const term = document.createElement("span");
    term.textContent = plainMarkdown(item.term ?? item.text);
    Object.assign(term.style, { font: "500 14px/1.4 Roboto, system-ui, sans-serif", color: t.text });
    top.append(term);
    if (item.time !== undefined) {
      const link = timeLink(t, item.time, onSeek);
      Object.assign(link.style, { marginRight: "0", background: t.bg });
      top.append(link);
    }
    card.append(top);
    if (item.term) {
      const body = document.createElement("div");
      body.textContent = plainMarkdown(item.text);
      Object.assign(body.style, { marginTop: "2px", font: "400 13px/1.5 Roboto, system-ui, sans-serif", color: t.sub });
      card.append(body);
    }
    grid.append(card);
  }
  return grid;
}

/** Learning: questions whose answer shows when you ask for it. */
function quiz(t: PanelTheme, questions: { question: string; answer: string }[]): HTMLElement {
  const box = document.createElement("div");
  box.dataset.tldwQuiz = "1";
  box.style.marginTop = "12px";
  const h = document.createElement("div");
  h.textContent = "Check yourself";
  Object.assign(h.style, { font: "500 13px/1.4 Roboto, system-ui, sans-serif", color: t.sub, marginBottom: "4px" });
  box.append(h);
  for (const q of questions) {
    const d = document.createElement("details");
    Object.assign(d.style, { padding: "4px 0" });
    const s = document.createElement("summary");
    s.textContent = plainMarkdown(q.question);
    Object.assign(s.style, { cursor: "pointer", font: "400 14px/22px Roboto, system-ui, sans-serif", color: t.text });
    const a = document.createElement("div");
    a.textContent = plainMarkdown(q.answer);
    Object.assign(a.style, { padding: "2px 0 2px 16px", font: "400 13px/1.5 Roboto, system-ui, sans-serif", color: t.sub });
    d.append(s, a);
    box.append(d);
  }
  return box;
}

/** A summary from before 1.4: the takeaway's supporting paragraphs and lists, in order. */
function legacyDetails(t: PanelTheme, details: string): HTMLElement {
  const box = document.createElement("div");
  let ul: HTMLUListElement | HTMLOListElement | null = null;
  let para: string[] = [];
  const flush = () => {
    if (!para.length) return;
    const p = document.createElement("p");
    p.textContent = plainMarkdown(para.join(" "));
    Object.assign(p.style, { margin: "8px 0 0", font: "400 14px/1.55 Roboto, system-ui, sans-serif", color: t.text });
    box.append(p);
    para = [];
  };
  for (const line of details.split("\n").map((l) => l.trim()).filter(Boolean)) {
    if (/^(•|\d+\.)\s/.test(line)) {
      flush();
      if (!ul) { ul = list(false); box.append(ul); }
      ul.append(row(t, { text: line.replace(/^(•|\d+\.)\s*/, "") }, () => {}));
    } else {
      ul = null;
      para.push(line);
    }
  }
  flush();
  return box;
}

/**
 * The summary itself: the takeaway first, then what the layout shows. Times
 * appear only on items that kept a checked time.
 */
export function summaryBody(t: PanelTheme, tldw: TldwSummary, onSeek: (seconds: number) => void): HTMLElement {
  const body = document.createElement("div");
  body.dataset.tldwBody = tldw.layout ?? "legacy";
  body.style.marginTop = "6px";

  const takeaway = document.createElement("p");
  takeaway.dataset.tldwTakeaway = "1";
  takeaway.textContent = plainMarkdown(tldw.summary);
  Object.assign(takeaway.style, { margin: "0", font: "500 15px/1.5 Roboto, system-ui, sans-serif", color: t.text });
  body.append(takeaway);

  const items = tldw.items ?? [];
  switch (tldw.layout) {
    case "tutorial": {
      const ol = list(true);
      items.forEach((item, i) => ol.append(row(t, item, onSeek, stepNumber(t, i + 1))));
      if (items.length) body.append(ol);
      break;
    }
    case "learning":
      if (items.length) body.append(ideaCards(t, items, onSeek));
      if (tldw.questions?.length) body.append(quiz(t, tldw.questions));
      break;
    case "quick":
    case "research":
    default:
      if (items.length) {
        const ul = list(false);
        for (const item of items) ul.append(row(t, item, onSeek));
        body.append(ul);
      }
  }
  if (!items.length && tldw.details) body.append(legacyDetails(t, tldw.details));
  if (tldw.note) body.append(note(t, tldw.note));
  return body;
}

/** The quiet line under the summary that says where it came from. */
export function sourceLine(t: PanelTheme, parts: string[], iconName: string): HTMLElement {
  const line = document.createElement("div");
  line.dataset.tldwSource = "1";
  Object.assign(line.style, {
    display: "flex", alignItems: "center", gap: "6px", marginTop: "12px",
    font: "400 12px/1.5 Roboto, system-ui, sans-serif", color: t.sub,
  });
  line.append(icon(iconName, 14));
  const text = document.createElement("span");
  text.textContent = parts.filter(Boolean).join(" · ");
  line.append(text);
  return line;
}
