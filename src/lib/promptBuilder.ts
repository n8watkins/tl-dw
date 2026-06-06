import type { Destination, PromptProfile, VideoContext } from "../types";

const FALLBACKS = {
  title: "Current YouTube video",
  channel: "Unknown channel",
};

/**
 * Variables that are optional: if not supplied, the entire line containing
 * them is removed rather than left as a visible {{placeholder}}.
 */
const OPTIONAL_VARS = new Set(["userCuriosity", "transcript"]);

export function buildPrompt(
  profile: PromptProfile,
  video: VideoContext,
  date = new Date().toISOString().slice(0, 10),
  extras: Record<string, string> = {},
): { prompt: string; missingVariables: string[] } {
  const values: Record<string, string> = {
    url: video.url,
    title: video.title?.trim() || FALLBACKS.title,
    channel: video.channel?.trim() || FALLBACKS.channel,
    date,
    ...extras,
  };

  const missing = new Set<string>();

  let template = profile.promptTemplate;

  // Remove entire lines for optional variables that were not supplied.
  for (const varName of OPTIONAL_VARS) {
    if (!(varName in values) || !values[varName]) {
      template = template
        .split("\n")
        .filter((line) => !line.includes(`{{${varName}}}`))
        .join("\n");
    }
  }

  const prompt = template
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => {
      if (name in values) return values[name];
      missing.add(name);
      return whole;
    })
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return { prompt, missingVariables: [...missing] };
}

/** Append the verbatim transcript to a prompt, when one is available. */
export function appendTranscript(
  prompt: string,
  transcript?: string | null,
): string {
  if (!transcript) return prompt;
  return `${prompt}\n\n---\nVideo transcript (verbatim):\n${transcript}`;
}

/**
 * Build the prompt for a specific destination. Gemini can open the video URL
 * itself (canWatch), so it gets the link only. Every other destination can't
 * watch the video, so the transcript is included — regardless of whether the
 * prompt is auto-typed or copied to the clipboard.
 */
export function buildDestinationPrompt(
  profile: PromptProfile,
  video: VideoContext,
  destination: Destination,
  transcript?: string | null,
): string {
  // Link-style destinations get just the video URL (e.g. NotebookLM ingesting
  // the YouTube link directly via its "Websites" source).
  if (destination.payload === "link") {
    return video.url;
  }
  // Source-style destinations (NotebookLM) ingest raw material, not a prompt:
  // hand them the transcript to add as a source. Fall back to the link if we
  // couldn't capture a transcript.
  if (destination.payload === "source") {
    return transcript ?? video.url;
  }
  const { prompt } = buildPrompt(profile, video);
  if (!destination.canWatch) {
    return appendTranscript(prompt, transcript);
  }
  return prompt;
}
