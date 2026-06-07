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

/**
 * Prepend a "worth watching?" directive so the response leads with a verdict
 * before the summary — used for videos over the configured length.
 */
export function prependWorthWatchingGate(
  prompt: string,
  minutes: number,
): string {
  const directive =
    `This video is long (about ${Math.round(minutes)} minutes). Before anything else, ` +
    `start your response with a single line — exactly "Verdict: WATCH", ` +
    `"Verdict: SKIM", or "Verdict: SKIP" — followed by one sentence saying why. ` +
    `Then give the full summary below.`;
  return `${directive}\n\n${prompt}`;
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
  userCuriosity?: string | null,
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
  const curiosity = userCuriosity?.trim() || undefined;
  // Hand the curiosity to {{userCuriosity}} so the template author controls
  // where it lands.
  const { prompt } = buildPrompt(
    profile,
    video,
    undefined,
    curiosity ? { userCuriosity: curiosity } : {},
  );
  // If the template has no {{userCuriosity}} placeholder, the curiosity would
  // otherwise be dropped — append it (labelled) so a typed question is never
  // silently ignored.
  const hasCuriosityVar = /\{\{\s*userCuriosity\s*\}\}/.test(profile.promptTemplate);
  const withCuriosity =
    curiosity && !hasCuriosityVar
      ? `${prompt}\n\nIn particular, address this: ${curiosity}`
      : prompt;
  if (!destination.canWatch) {
    return appendTranscript(withCuriosity, transcript);
  }
  return withCuriosity;
}
