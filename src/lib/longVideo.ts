/**
 * Long videos with the Gemini API, done in passes instead of failing:
 *
 * - A transcript longer than one request takes (about 17 hours of speech) is
 *   split into parts; each part becomes timed notes, and one last request
 *   summarizes the notes. The notes keep each point's time and exact words, so
 *   the final times are still checked against the whole transcript.
 * - A video without a transcript that is too long for Gemini to watch in one
 *   request (low-resolution video is about 100 tokens a second, so a million
 *   tokens is under 3 hours) is watched in two-hour stretches the same way.
 */
import { buildFromNotesPrompt, buildNotesPrompt, buildWatchPrompt, type SummaryPromptInput } from "./promptBuilder";
import type { GeminiRequest } from "./geminiApi";

/** Ask Gemini once; resolves to its answer's text. */
export type AskGemini = (request: GeminiRequest) => Promise<string>;

/** The longest stretch of video Gemini watches in one request. */
export const VIDEO_WINDOW_SECONDS = 2 * 60 * 60;
/** Videos up to this long are watched in one request. */
export const ONE_REQUEST_VIDEO_SECONDS = 2.5 * 60 * 60;

/** Consecutive [start, end] stretches covering the video, each at most `max` seconds. */
export function videoWindows(durationSeconds: number, max = VIDEO_WINDOW_SECONDS): [number, number][] {
  if (!(durationSeconds > 0)) return [];
  const count = Math.ceil(durationSeconds / max);
  const size = Math.ceil(durationSeconds / count);
  return Array.from({ length: count }, (_, i) => [i * size, Math.min(durationSeconds, (i + 1) * size)]);
}

/** Notes for each transcript part, then one summary of all of them. */
export async function summarizeTranscriptInParts(
  ask: AskGemini,
  input: SummaryPromptInput,
  chunks: string[],
  timed: boolean,
  onProgress?: (step: string) => void,
): Promise<{ text: string; prompt: string }> {
  const notes: string[] = [];
  for (let i = 0; i < chunks.length; i++) {
    onProgress?.(`Reading part ${i + 1} of ${chunks.length} of the transcript…`);
    notes.push(await ask({ prompt: buildNotesPrompt(input, chunks[i]!, i, chunks.length, timed) }));
  }
  onProgress?.("Putting the parts together…");
  const prompt = buildFromNotesPrompt(input, notes, timed);
  return { text: await ask({ prompt }), prompt };
}

/** Watch the video: in one request, or in stretches when it's too long for one. */
export async function watchVideo(
  ask: AskGemini,
  input: SummaryPromptInput,
  videoUrl: string,
  durationSeconds: number,
  onProgress?: (step: string) => void,
): Promise<{ text: string; prompt: string }> {
  const prompt = buildWatchPrompt(input);
  if (!(durationSeconds > ONE_REQUEST_VIDEO_SECONDS)) {
    return { text: await ask({ prompt, videoUrl }), prompt };
  }
  const windows = videoWindows(durationSeconds);
  const notes: string[] = [];
  for (let i = 0; i < windows.length; i++) {
    const [start, end] = windows[i]!;
    onProgress?.(`Gemini is watching part ${i + 1} of ${windows.length} of the video…`);
    notes.push(await ask({
      prompt:
        `This is part ${i + 1} of ${windows.length} of the YouTube video "${input.video.title?.trim() || "this video"}". ` +
        "List its 8 to 12 most important points, in order, one per line, as:\n- point, under 20 words\nWrite only the list.",
      videoUrl,
      startSeconds: start,
      endSeconds: end,
    }));
  }
  onProgress?.("Putting the parts together…");
  const finalPrompt = buildFromNotesPrompt(input, notes, false);
  return { text: await ask({ prompt: finalPrompt }), prompt: finalPrompt };
}
