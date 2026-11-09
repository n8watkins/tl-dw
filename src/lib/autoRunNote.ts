/**
 * What the "Enable auto-run?" confirmation says about how each automatic
 * summary is made. It must match the mode the user is actually in: with a key
 * TL;DW calls the Gemini API; without one it opens Gemini in a background tab.
 */
export type AutoRunNote = {
  note: string;
  /** The link under the note: the key's usage, or where to add a free key. */
  action: { label: string; target: "api-usage" | "key-setup" };
};

export function autoRunNote(usesKey: boolean): AutoRunNote {
  if (usesKey) {
    return {
      note: "Each summary uses your Gemini API key. Free-tier keys include a generous daily quota.",
      action: { label: "View API usage →", target: "api-usage" },
    };
  }
  return {
    note: "You haven't added a Gemini API key, so each new video opens Gemini in a background tab to make its summary.",
    action: { label: "Add a free API key instead →", target: "key-setup" },
  };
}

/** Whether the settings use the user's own Gemini key (Direct API on, with a key). */
export function usesOwnKey(settings: { useDirectApi?: unknown; geminiApiKey?: unknown } | undefined): boolean {
  return settings?.useDirectApi === true && typeof settings.geminiApiKey === "string" && settings.geminiApiKey.length > 0;
}
