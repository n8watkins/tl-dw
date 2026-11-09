/**
 * How a summary request is carried out, decided before anything is sent:
 * TL;DW knows the transcript and its length up front, so it never cuts a
 * transcript silently and never sends a prompt that has only the title.
 *
 * - `api-transcript`: the Gemini API reads the whole transcript.
 * - `api-video`: no transcript, so the Gemini API watches the YouTube video
 *   (video input). This is the only path where Gemini sees the video itself.
 * - `tab-transcript`: the Gemini tab gets the prompt with the whole transcript.
 * - `tab-excerpt`: the Gemini tab gets as much of a long transcript as fits (its
 *   start and end, the middle marked as left out), and the summary is labeled so.
 * - `tab-link`: the Gemini tab gets the link, because there is no transcript.
 * - `api-too-long`: longer than even the API budget (about 17 hours of speech).
 */
export type SendPlanKind =
  | "api-transcript"
  | "api-video"
  | "tab-transcript"
  | "tab-excerpt"
  | "tab-link"
  | "api-too-long";

export type SendPlanInput = {
  /** Whether this send goes through the Gemini API. */
  useApi: boolean;
  /** Whether TL;DW could read the transcript. */
  hasTranscript: boolean;
  /** Whether the whole transcript fits the Gemini tab's (or the API's) limit. */
  transcriptFits: boolean;
};

export function planSend({ useApi, hasTranscript, transcriptFits }: SendPlanInput): SendPlanKind {
  if (useApi) {
    if (!hasTranscript) return "api-video";
    return transcriptFits ? "api-transcript" : "api-too-long";
  }
  if (hasTranscript) return transcriptFits ? "tab-transcript" : "tab-excerpt";
  return "tab-link";
}

/** The sentence that points someone without a key at the free API. */
export const ADD_KEY_WHOLE_VIDEO = "Add a free API key to summarize the whole video.";
export const ADD_KEY_TO_WATCH = "Add a free API key so Gemini can watch it.";

/** Shown on the page while a long video's shortened transcript goes to a chat tab. */
export function excerptNotice(site: string, hasKey: boolean): string {
  return `This video is long, so ${site} gets part of the transcript (its start and end).` +
    (hasKey ? "" : ` ${ADD_KEY_WHOLE_VIDEO}`);
}

/** Shown on the page while the Gemini web app gets the link of a video without a transcript. */
export function noTranscriptLinkNotice(hasKey: boolean): string {
  return "TL;DW couldn't read a transcript for this video, so Gemini gets the link and can only " +
    "summarize public info about the video, not the video itself." + (hasKey ? "" : ` ${ADD_KEY_TO_WATCH}`);
}

/** The label on a summary the Gemini API made by watching the video. */
export const WATCHED_BY_GEMINI_LABEL = "Watched by Gemini (no transcript)";

/** The label on a summary the signed-in Gemini web app made from the video's captions. */
export const SIGNED_IN_TRANSCRIPT_LABEL = "Gemini read the video's transcript through YouTube";

/** Shown on the page while a long video goes to the Gemini tab (signed in or not). */
export function geminiLongNotice(hasKey: boolean): string {
  return "This video is long. Signed in to Gemini, it reads the transcript through YouTube; " +
    "signed out, it gets the transcript's start and end." + (hasKey ? "" : ` ${ADD_KEY_WHOLE_VIDEO}`);
}

/** Shown on the page while a captioned video whose transcript TL;DW couldn't read goes to the Gemini tab. */
export function captionsLinkNotice(hasKey: boolean): string {
  return "TL;DW couldn't read this video's transcript, so Gemini gets the link. Signed in, Gemini reads the " +
    "captions through YouTube; signed out, it can only summarize public info about the video." +
    (hasKey ? "" : ` ${ADD_KEY_TO_WATCH}`);
}

/** The label on a summary made from part of a long transcript. */
export function excerptLabel(hasKey: boolean): string {
  return "Summarized from part of the transcript (video is long)." + (hasKey ? "" : ` ${ADD_KEY_WHOLE_VIDEO}`);
}

/** The label on a summary the Gemini web app made from a link (public info only). */
export function publicInfoLabel(hasKey: boolean): string {
  return "No transcript, so Gemini summarized from public info about this video, not the video itself." +
    (hasKey ? "" : ` ${ADD_KEY_TO_WATCH}`);
}

export const API_TOO_LONG_MESSAGE =
  "This transcript is longer than the 1,000,000 characters TL;DW sends to the Gemini API, so it wasn't summarized.";

export const NOT_WATCHABLE_MESSAGE =
  "TL;DW couldn't read a transcript for this video, and Gemini can only watch public videos, " +
  "so this one can't be summarized.";
