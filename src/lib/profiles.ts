import type { PromptProfile } from "../types";

function now() {
  return new Date().toISOString();
}

export function createDefaultProfiles(): PromptProfile[] {
  const ts = now();
  const base = (
    id: string,
    name: string,
    description: string,
    promptTemplate: string,
  ): PromptProfile => ({
    id,
    name,
    description,
    promptTemplate: promptTemplate.trim(),
    isDefault: true,
    createdAt: ts,
    updatedAt: ts,
  });

  return [
    base(
      "tldw",
      "TL;DW",
      "The too long; didn't watch version: a verdict, a one-line summary, and key details.",
      `You watched this YouTube video so I don't have to. Tell me whether it's worth my time and what it actually concludes — not just what topics it covers.

Video: {{title}}
Channel: {{channel}}

Respond with ONLY the structured block below — no introduction, no extra sections, no preamble. The SUMMARY is one sharp sentence stating the video's real conclusion or argument. DETAILS is 2-4 sentences on the key support, notable caveats, or what's skippable. Don't invent anything; if the transcript is thin, say what's uncertain.`,
    ),
    base(
      "research",
      "Research Mode",
      "Fact-checking and research brief. Claims, evidence, what needs verification.",
      `Analyze this YouTube video as a fact-checking and research brief.

Video: {{title}}
Channel: {{channel}}
URL: {{url}}
Date: {{date}}
{{userCuriosity}}

Your job is not just to summarize the video. Your job is to identify what the video claims, what evidence it gives, what is opinion or speculation, and what would need to be verified elsewhere.

Write the response like a readable analyst note. Use short headers and natural paragraphs. Bullets are okay when listing specific claims or follow-up research questions, but avoid making the whole answer feel like a form.

Explain the main claim or thesis, the strongest supporting points, the weak spots, and any missing context. Separate what seems factual from what seems interpretive, speculative, exaggerated, or unsupported. If the user gave a specific curiosity, focus the analysis around that question.

End with a short section on what I should fact-check next and how much research value the video has.

Do not invent sources, studies, quotes, timestamps, or external facts. If the video does not provide enough information to evaluate a claim, say so clearly.`,
    ),
    base(
      "learning",
      "Learning Mode",
      "Deep concept exploration. Mental models, definitions, examples, what to explore next.",
      `Analyze this YouTube video as a learning and concept-exploration resource.

Video: {{title}}
Channel: {{channel}}
URL: {{url}}
Date: {{date}}
{{userCuriosity}}

Your job is to help me understand the ideas in the video more deeply. Focus on concepts, mental models, definitions, examples, and useful ways of thinking.

Write the response like a smart teacher walking me through the interesting ideas. Use readable paragraphs and short section headers. Use bullets only when listing terms, related ideas, or memorable concepts.

Explain the main concepts in simple language first, then go one level deeper. Point out any useful analogies, examples, or frameworks from the video. Include "quotable concepts" when helpful: clean, memorable paraphrases of the ideas. Only include exact quotes if they are clearly supported by the transcript.

If the user gave a curiosity, use it as the lens for what to explain. End with related ideas I may want to explore next.

Do not turn this into a fact-checking report or a step-by-step tutorial unless the video itself calls for it. The goal is understanding, not verification or execution.`,
    ),
    base(
      "tutorial",
      "Tutorial Mode",
      "Practical tutorial brief. What it teaches, prerequisites, tradeoffs, best next action.",
      `Analyze this YouTube video as a practical tutorial and improvement plan.

Video: {{title}}
Channel: {{channel}}
URL: {{url}}
Date: {{date}}
{{userCuriosity}}

Your job is to figure out whether this video can help me actually do something better: improve a skill, build a habit, use a tool, make a decision, or execute a workflow.

Write the response in a practical, readable style. Use steps only when there is a real sequence to follow. Do not force everything into a numbered list.

Explain what the video teaches me to do, what prerequisites or tools are needed, and what I could realistically try first. Include the tradeoffs: time cost, complexity, likely payoff, opportunity cost, and alternative ways to get the same improvement.

If the video is vague, motivational, repetitive, or not actually actionable, say that directly. End with the best next action I should take and whether the video is worth watching for execution.

Do not invent steps, tools, costs, or outcomes that are not supported by the video.`,
    ),
    base(
      "moment-finder",
      "Moment Finder",
      "Find the 3-5 strongest moments worth watching. Timestamps when available.",
      `Analyze this YouTube video and find the strongest moments worth watching or revisiting.

Video: {{title}}
Channel: {{channel}}
URL: {{url}}
Date: {{date}}
{{userCuriosity}}

Your job is to identify the highest-value parts of the video: the clearest explanation, strongest argument, most useful example, best quote, key turning point, surprising claim, or practical step.

Do not frame this as repurposing someone else's content. This is not "clip ideas." This is about helping me jump to the parts that are actually worth my attention.

Present each moment as a readable card-style section. Include the timestamp if it is available. If exact timestamps are not available, describe the section instead of inventing one. For each moment, explain what happens, why it matters, and whether it stands alone or needs context.

When possible, include a clickable YouTube timestamp link using the video URL and timestamp. Include an exact quote only if clearly supported by the transcript. Otherwise, include a short "quotable concept" as a paraphrase.

Keep the number of moments selective. Prefer 3 to 5 strong moments over a long list of weak ones. End by saying whether watching only these moments is enough or whether the full video is worth watching.

Do not invent timestamps, quotes, or moments.`,
    ),
  ];
}

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
