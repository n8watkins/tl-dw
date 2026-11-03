import type { Destination } from "../types";

/**
 * How a summary request is carried out, decided before anything is sent:
 * TL;DW knows the transcript and its length up front, so it never cuts a
 * transcript silently and never sends a prompt that has only the title.
 *
 * - `api-transcript`: the Gemini API reads the whole transcript.
 * - `api-video`: no transcript, so the Gemini API watches the YouTube video
 *   (video input). This is the only path where Gemini sees the video itself.
 * - `tab-transcript`: a chat site gets the prompt with the whole transcript.
 * - `tab-excerpt`: a chat site gets as much of a long transcript as fits (its
 *   start and end, the middle marked as left out), and the summary is labeled
 *   so. The Gemini web app gets this without asking; ChatGPT and Claude only
 *   after the user chose it.
 * - `tab-link`: the Gemini web app gets the link, because there is no
 *   transcript. Without the API, Gemini can't watch YouTube videos: it can only
 *   look up public information about the video, and the summary is labeled so.
 * - `tab-plain`: a link or source destination (NotebookLM).
 * - `choose-long`: ChatGPT or Claude and a transcript too long for them: ask
 *   the user on the page what to do.
 * - `choose-no-transcript`: the same sites and no transcript at all.
 * - `api-too-long`: longer than even the API budget (about 17 hours of speech).
 */
export type SendPlanKind =
  | "api-transcript"
  | "api-video"
  | "tab-transcript"
  | "tab-excerpt"
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
  /** The user explicitly chose "send part of the transcript". */
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
  if (hasTranscript) {
    if (transcriptFits) return "tab-transcript";
    // The real transcript, even shortened, beats a link the web app can't watch.
    return destination.canWatch || input.allowTruncate ? "tab-excerpt" : "choose-long";
  }
  return destination.canWatch ? "tab-link" : "choose-no-transcript";
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

/** The label on a summary made from part of a long transcript. */
export function excerptLabel(hasKey: boolean): string {
  return "Summarized from part of the transcript (video is long)." + (hasKey ? "" : ` ${ADD_KEY_WHOLE_VIDEO}`);
}

/** The label on a summary the Gemini web app made from a link (public info only). */
export function publicInfoLabel(hasKey: boolean): string {
  return "No transcript, so Gemini summarized from public info about this video, not the video itself." +
    (hasKey ? "" : ` ${ADD_KEY_TO_WATCH}`);
}

export function longTranscriptChoiceMessage(site: string): string {
  return `This video's transcript is too long for ${site}'s message box, and ${site} can't watch YouTube videos. ` +
    "How do you want to summarize it?";
}

export function noTranscriptChoiceMessage(site: string, hasKey: boolean): string {
  return `TL;DW couldn't read a transcript for this video, and ${site} can't watch YouTube videos. ` +
    (hasKey
      ? "With your API key, Gemini can watch it."
      : "Without an API key, Gemini can't watch it either: from the link it can only summarize public info about the video.");
}

export const API_TOO_LONG_MESSAGE =
  "This transcript is longer than the 1,000,000 characters TL;DW sends to the Gemini API, so it wasn't summarized.";

export const NOT_WATCHABLE_MESSAGE =
  "TL;DW couldn't read a transcript for this video, and Gemini can only watch public videos, " +
  "so this one can't be summarized.";
