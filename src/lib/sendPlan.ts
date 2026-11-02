import type { Destination } from "../types";

/**
 * How a summary request is carried out, decided before anything is sent:
 * TL;DW knows the transcript and its length up front, so it never cuts a
 * transcript silently and never sends a prompt that has only the title.
 *
 * - `api-transcript`: the Gemini API reads the whole transcript.
 * - `api-video`: no transcript, so the Gemini API watches the YouTube video.
 * - `tab-transcript`: a chat site gets the prompt with the whole transcript.
 * - `tab-head`: the user chose to send only the first part of a long transcript.
 * - `tab-link`: the Gemini web app gets the link and watches the video itself,
 *   because the transcript is too long for its message box or there is none.
 * - `tab-plain`: a link or source destination (NotebookLM).
 * - `choose-long`: a chat site that can't watch YouTube and a transcript too
 *   long for it: ask the user on the page what to do.
 * - `choose-no-transcript`: the same site and no transcript at all.
 * - `api-too-long`: longer than even the API budget (about 17 hours of speech).
 */
export type SendPlanKind =
  | "api-transcript"
  | "api-video"
  | "tab-transcript"
  | "tab-head"
  | "tab-link"
  | "tab-plain"
  | "choose-long"
  | "choose-no-transcript"
  | "api-too-long";

export type SendPlanInput = {
  /** Whether this send goes through the Gemini API. */
  useApi: boolean;
  destination: Destination;
  /** Whether TL;DW could read the transcript. */
  hasTranscript: boolean;
  /** Whether the whole transcript fits the destination's (or the API's) limit. */
  transcriptFits: boolean;
  /** The user explicitly chose "send the first part only". */
  allowTruncate?: boolean;
};

export function planSend(input: SendPlanInput): SendPlanKind {
  const { useApi, destination, hasTranscript, transcriptFits } = input;
  const isPromptDest = destination.payload !== "link" && destination.payload !== "source";
  if (!isPromptDest) return "tab-plain";
  if (useApi) {
    if (!hasTranscript) return "api-video";
    return transcriptFits ? "api-transcript" : "api-too-long";
  }
  if (hasTranscript && transcriptFits) return "tab-transcript";
  if (destination.canWatch) return "tab-link";
  if (!hasTranscript) return "choose-no-transcript";
  return input.allowTruncate ? "tab-head" : "choose-long";
}

/** Shown on the page when the Gemini web app gets the link of a long video. */
export const LONG_VIDEO_LINK_NOTICE =
  "This video is long, so Gemini will watch it from the link. Add a free API key to summarize long videos from the transcript.";
/** The same, for someone who already has a key but sent to the Gemini tab. */
export const LONG_VIDEO_LINK_NOTICE_WITH_KEY =
  "This video is long, so Gemini will watch it from the link.";
/** Shown on the page when the Gemini web app gets the link of a video without a transcript. */
export const NO_TRANSCRIPT_LINK_NOTICE =
  "TL;DW couldn't read a transcript for this video, so Gemini will watch it from the link.";
/** The label on a summary the Gemini API made by watching the video. */
export const WATCHED_BY_GEMINI_LABEL = "Watched by Gemini (no transcript)";
/** The label on a summary the Gemini web app made by watching the video from its link. */
export const WATCHED_FROM_LINK_LABEL = "Watched by Gemini (from the link)";

export function longTranscriptChoiceMessage(site: string): string {
  return `This video's transcript is too long for ${site}'s message box, and ${site} can't watch YouTube videos. ` +
    "How do you want to summarize it?";
}

export function noTranscriptChoiceMessage(site: string): string {
  return `TL;DW couldn't read a transcript for this video, and ${site} can't watch YouTube videos. ` +
    "Gemini can watch it from the link instead.";
}

export const API_TOO_LONG_MESSAGE =
  "This transcript is longer than the 1,000,000 characters TL;DW sends to the Gemini API, so it wasn't summarized.";

export const NOT_WATCHABLE_MESSAGE =
  "TL;DW couldn't read a transcript for this video, and Gemini can only watch public videos, " +
  "so this one can't be summarized.";
