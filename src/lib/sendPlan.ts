/**
 * How a summary request is carried out, decided before anything is sent.
 * Transcript first, in both modes (owner decision, 9 Nov 2026): TL;DW sends
 * the transcript it read itself whenever there is one, and falls back to the
 * video's link only when there is none. A link-based summary never shows times.
 *
 * - `api-transcript`: the Gemini API reads the whole transcript in one request.
 * - `api-transcript-long`: a transcript longer than one request takes (about
 *   17 hours of speech): notes per part, then one summary of the notes.
 * - `api-video`: no transcript, so the Gemini API watches the video (a very
 *   long one in parts, by time range).
 * - `tab-transcript`: the Gemini tab gets the whole transcript in one message.
 * - `tab-parts`: a transcript too long for one message goes to the Gemini tab
 *   in several, then the request, so Gemini reads all of it.
 * - `tab-excerpt`: longer still: its start and end, the middle marked as left
 *   out, and the summary says so.
 * - `tab-link`: no transcript: the link, which only a signed-in Gemini can
 *   read (it reads the captions through YouTube); signed out, the page asks
 *   the user to sign in instead of showing a made-up answer.
 */
export type SendPlanKind =
  | "api-transcript"
  | "api-transcript-long"
  | "api-video"
  | "tab-transcript"
  | "tab-parts"
  | "tab-excerpt"
  | "tab-link";

export type SendPlanInput = {
  /** Whether this send goes through the Gemini API. */
  useApi: boolean;
  /** Whether TL;DW could read the transcript. */
  hasTranscript: boolean;
  /** Whether the whole prompt fits one request or one message. */
  fitsOne: boolean;
  /** For the Gemini tab: how many messages the transcript needs. */
  partsNeeded?: number;
};

/** The most messages TL;DW sends the Gemini tab for one video (about 6 hours of speech). */
export const MAX_TAB_PARTS = 12;

/** Room per message for a transcript part, under the Gemini tab's 30,000-character limit. */
export const TAB_PART_CHARS = 27_000;

/** Room per API request for a transcript part, when one request isn't enough. */
export const API_PART_CHARS = 800_000;

export function planSend({ useApi, hasTranscript, fitsOne, partsNeeded = 1 }: SendPlanInput): SendPlanKind {
  if (useApi) {
    if (!hasTranscript) return "api-video";
    return fitsOne ? "api-transcript" : "api-transcript-long";
  }
  if (!hasTranscript) return "tab-link";
  if (fitsOne) return "tab-transcript";
  return partsNeeded <= MAX_TAB_PARTS ? "tab-parts" : "tab-excerpt";
}

/** The sentence that points someone without a key at the free API. */
export const ADD_KEY_WHOLE_VIDEO = "Add a free API key to summarize the whole video.";
export const ADD_KEY_TO_WATCH = "Add a free API key so Gemini can watch it.";

/** Shown on the page while a long transcript goes to the Gemini tab in parts. */
export function partsNotice(parts: number): string {
  return `This video is long, so Gemini gets its transcript in ${parts} parts. This takes a little longer.`;
}

/** Shown on the page while a very long video's shortened transcript goes to the Gemini tab. */
export function excerptNotice(hasKey: boolean): string {
  return "This video is very long, so Gemini gets part of the transcript (its start and end)." +
    (hasKey ? "" : ` ${ADD_KEY_WHOLE_VIDEO}`);
}

/** Shown on the page while a video without a transcript goes to the Gemini tab as its link. */
export function linkNotice(hasKey: boolean): string {
  return "This video has no transcript TL;DW can read, so Gemini gets its link and reads the captions through YouTube " +
    "(this needs you to be signed in to Gemini)." + (hasKey ? "" : ` ${ADD_KEY_TO_WATCH}`);
}

/** What the page says when the Gemini tab is signed out and there is no transcript (item 6). */
export const SIGN_IN_MESSAGE =
  "This video has no transcript. Sign in to Gemini to summarize it from the video.";

/** Signed in, but Gemini still couldn't open the video or its captions. */
export function cannotAccessMessage(hasKey: boolean): string {
  return "Gemini couldn't open this video or its captions, so there's nothing to summarize." +
    (hasKey ? "" : ` ${ADD_KEY_TO_WATCH}`);
}

export const NOT_WATCHABLE_MESSAGE =
  "TL;DW couldn't read a transcript for this video, and Gemini can only watch public videos, " +
  "so this one can't be summarized.";
