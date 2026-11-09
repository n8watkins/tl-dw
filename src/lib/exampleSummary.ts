/**
 * One real summary that ships with TL;DW, so a new user (or a store reviewer)
 * can see what TL;DW makes before setting anything up. It is static data: the
 * example page shows it without a key and without any network request.
 *
 * Made once on 2026-11-09 by TL;DW 1.1.3 with no key: its default "TL;DW"
 * profile, sent through the Gemini web app (signed out), from the video's
 * transcript. The text is Gemini's answer as TL;DW parsed it, unedited.
 */
export const EXAMPLE_SUMMARY = {
  videoId: "UF8uR6Z6KLc",
  videoUrl: "https://www.youtube.com/watch?v=UF8uR6Z6KLc",
  videoTitle: "Steve Jobs' 2005 Stanford Commencement Address",
  channel: "Stanford",
  madeOn: "November 9, 2026",
  summary:
    "Trust your intuition, pursue work you love despite setbacks, and let the certainty of death guide you toward authentic choices.",
  details:
    "Life's trajectory cannot be mapped out in advance, so you must trust that your past experiences will eventually connect in meaningful ways. Major failures, such as being fired from a company you built, can remove the pressure of success and spark profound creative renewal. Because death is life's ultimate change agent, keeping mortality in mind strips away external expectations and leaves only what truly matters.",
} as const;
