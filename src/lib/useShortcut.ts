import { useEffect, useState } from "react";

/** The manifest command that summarizes the current video. */
export const SUMMARIZE_COMMAND = "ask-gemini";

/**
 * The keyboard shortcut Chrome actually assigned to "Summarize with TL;DW"
 * (it differs on a Mac, after the user changes it, or when another extension
 * took it), as Chrome writes it ("Alt+Shift+G", "⇧⌘G"). "" when none is set;
 * null until it is known.
 */
export function useSummarizeShortcut(): string | null {
  const [shortcut, setShortcut] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    void chrome.commands.getAll().then(
      (commands) => {
        if (alive) setShortcut(commands.find((c) => c.name === SUMMARIZE_COMMAND)?.shortcut ?? "");
      },
      () => { if (alive) setShortcut(""); },
    );
    return () => { alive = false; };
  }, []);
  return shortcut;
}

/** "Alt+Shift+G" -> ["Alt", "Shift", "G"]; "⇧⌘G" (Mac) -> ["⇧", "⌘", "G"]. */
export function shortcutKeys(shortcut: string): string[] {
  if (shortcut.includes("+")) return shortcut.split("+");
  return [...shortcut];
}
