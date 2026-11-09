import { SUMMARY_LAYOUTS } from "./summaryFormat";
import type { PromptProfile, SummaryLayout } from "../types";

function now() {
  return new Date().toISOString();
}

/**
 * The built-in profiles. Each has its own layout (see summaryFormat.ts), so
 * switching profile visibly changes what lands on the page. The template is
 * only the guidance; TL;DW appends the output format for the layout.
 */
export function createDefaultProfiles(): PromptProfile[] {
  const ts = now();
  const base = (
    id: string,
    name: string,
    description: string,
    layout: SummaryLayout,
    promptTemplate: string,
  ): PromptProfile => ({
    id,
    name,
    description,
    layout,
    promptTemplate: promptTemplate.trim(),
    isDefault: true,
    createdAt: ts,
    updatedAt: ts,
  });

  return [
    base(
      "tldw",
      "Quick",
      "The takeaway and three key points.",
      "quick",
      `You watched this YouTube video so I don't have to. Tell me what it actually concludes and the points that carry it, not just the topics it covers.

Video: {{title}}
Channel: {{channel}}
{{userCuriosity}}

Don't invent anything; if the transcript is thin, say what's uncertain.`,
    ),
    base(
      "research",
      "Research",
      "Claims, how the video backs each one, and what it leaves out.",
      "research",
      `Read this YouTube video the way a careful fact-checker would.

Video: {{title}}
Channel: {{channel}}
Date: {{date}}
{{userCuriosity}}

List the claims it makes, and for each say how the video backs it: it shows evidence, it only states it, it's an opinion, or it's worth checking elsewhere (say why, for example a figure that may be out of date). Then name the most important thing it leaves out. Don't invent sources, studies or facts.`,
    ),
    base(
      "learning",
      "Learning",
      "The key ideas as cards, and two questions to test yourself.",
      "learning",
      `Help me understand the ideas in this YouTube video.

Video: {{title}}
Channel: {{channel}}
{{userCuriosity}}

Pick the ideas the video builds on and explain each in plain words a beginner understands, using the video's own examples. Then write two questions that check whether I understood, each with its answer from the video.`,
    ),
    base(
      "tutorial",
      "Tutorial",
      "Numbered steps, and what you need first.",
      "tutorial",
      `Turn this YouTube video into steps I can follow.

Video: {{title}}
Channel: {{channel}}
{{userCuriosity}}

List the steps in the order to do them, each an instruction that starts with a verb, using only what the video shows. Then say what I need first: tools, accounts or knowledge. If the video isn't really a how-to, give the closest practical steps it supports, and don't invent any.`,
    ),
  ];
}

/** The built-in profile ids, in order. */
export const BUILT_IN_PROFILE_IDS = ["tldw", "research", "learning", "tutorial"] as const;

/** The default profile: Quick. */
export const DEFAULT_PROFILE_ID = "tldw";

/** Returns the original template for a built-in profile id, for reset. */
export function getOriginalTemplate(id: string): string | undefined {
  return createDefaultProfiles().find((p) => p.id === id)?.promptTemplate;
}

/** Collapse whitespace and trim, so name comparisons/uniqueness are stable. */
export function normalizeName(name: string): string {
  return name.trim().replace(/\s+/g, " ");
}

/** A name not already taken (case-insensitive), suffixing " (2)", " (3)", … */
export function nextAvailableName(profiles: PromptProfile[], baseName: string): string {
  const base = normalizeName(baseName) || "New Profile";
  const used = new Set(profiles.map((p) => normalizeName(p.name).toLowerCase()));
  if (!used.has(base.toLowerCase())) return base;

  let index = 2;
  while (used.has(`${base} (${index})`.toLowerCase())) index += 1;
  return `${base} (${index})`;
}

export type ImportProfilesResult =
  | { ok: false; error: string }
  | { ok: true; profiles: PromptProfile[]; added: number; skipped: number };

/**
 * Merge profiles parsed from an import file into the existing set. Accepts a
 * bare array or the `{ profiles: [...] }` export envelope. Each valid entry is
 * brought in as a *new* custom profile: fresh id, conflict-free name, and never
 * inheriting isDefault/isCustomized from the source. Pure (no storage) so it's
 * unit-testable; the caller persists the result.
 */
export function mergeImportedProfiles(
  existing: PromptProfile[],
  parsed: unknown,
  makeId: () => string = () => crypto.randomUUID(),
  timestamp: string = new Date().toISOString(),
): ImportProfilesResult {
  const incoming = Array.isArray(parsed)
    ? parsed
    : (parsed as { profiles?: unknown } | null)?.profiles;
  if (!Array.isArray(incoming)) {
    return { ok: false, error: "No profiles found in that file." };
  }

  const working = [...existing];
  let added = 0;
  let skipped = 0;
  for (const raw of incoming as Array<Record<string, unknown>>) {
    if (!raw || typeof raw.name !== "string" || typeof raw.promptTemplate !== "string") {
      skipped += 1;
      continue;
    }
    working.push({
      id: makeId(),
      name: nextAvailableName(working, normalizeName(raw.name) || "Imported Profile"),
      description: typeof raw.description === "string" ? raw.description : "",
      promptTemplate: raw.promptTemplate,
      ...(SUMMARY_LAYOUTS.some((l) => l.id === raw.layout) ? { layout: raw.layout as SummaryLayout } : {}),
      createdAt: timestamp,
      updatedAt: timestamp,
    });
    added += 1;
  }

  if (added === 0) {
    return { ok: false, error: "No valid profiles to import." };
  }
  return { ok: true, profiles: working, added, skipped };
}
