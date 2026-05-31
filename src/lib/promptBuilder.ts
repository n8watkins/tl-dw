import type { PromptProfile, VideoContext } from "../types";

const FALLBACKS = {
  title: "Current YouTube video",
  channel: "Unknown channel",
};

/**
 * Replace {{title}}, {{url}}, {{channel}}, {{date}} in a profile template with
 * the video context, applying fallbacks for missing metadata. Unknown
 * variables are left untouched and returned for an optional warning UI.
 */
export function buildPrompt(
  profile: PromptProfile,
  video: VideoContext,
  date = new Date().toISOString().slice(0, 10),
): { prompt: string; missingVariables: string[] } {
  const values: Record<string, string> = {
    url: video.url,
    title: video.title?.trim() || FALLBACKS.title,
    channel: video.channel?.trim() || FALLBACKS.channel,
    date,
  };

  const missing = new Set<string>();
  const prompt = profile.promptTemplate
    .replace(/\{\{\s*(\w+)\s*\}\}/g, (whole, name: string) => {
      if (name in values) return values[name];
      missing.add(name);
      return whole;
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim();

  return { prompt, missingVariables: [...missing] };
}
