import type { TldwSummary } from "../types";

/**
 * One real summary that ships with TL;DW, so a new user (or a store reviewer)
 * can see what TL;DW makes before setting anything up. It is static data: the
 * example page shows it without a key and without any network request.
 *
 * Made on 2026-11-09 by the TL;DW 1.4 build with no key: the Quick profile,
 * sent through the Gemini web app (signed out) with the video's timed
 * transcript. The text is Gemini's answer as TL;DW parsed it, unedited, and
 * each time passed TL;DW's check against the captions.
 */
export const EXAMPLE_SUMMARY = {
  videoId: "UF8uR6Z6KLc",
  videoUrl: "https://www.youtube.com/watch?v=UF8uR6Z6KLc",
  videoTitle: "Steve Jobs' 2005 Stanford Commencement Address",
  channel: "Stanford",
  madeOn: "November 9, 2026",
  tldw: {
    summary:
      "Trust your intuition and follow your heart by doing what you love and remembering that death is inevitable.",
    layout: "quick",
    items: [
      { time: 307, text: "You can only connect dots looking backwards, so you must trust they will connect in the future." },
      { time: 515, text: "Find what you love because the only way to be satisfied is to do great work." },
      { time: 600, text: "Remembering you are going to die is the best way to avoid the trap of thinking you have something to lose." },
    ],
    timed: true,
    basis: "transcript",
    via: "tab",
    profileName: "Quick",
  } satisfies TldwSummary,
} as const;
