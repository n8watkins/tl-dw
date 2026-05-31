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
    isDefault = false,
  ): PromptProfile => ({
    id,
    name,
    description,
    promptTemplate: promptTemplate.trim(),
    isDefault,
    createdAt: ts,
    updatedAt: ts,
  });

  return [
    base(
      "tldw",
      "TL;DW",
      "The too long; didn't watch version. Core idea, key takeaways, watch/skim/skip.",
      `Analyze this YouTube video and give me the "too long; didn't watch" version.

Video: {{title}}
Channel: {{channel}}
URL: {{url}}
Date: {{date}}

Your job is to quickly tell me what this video is about, what matters, and whether it is worth my time. Write it like a smart, readable summary from someone who watched the video for me.

Keep the response concise. Use short paragraphs with clear section headers. Avoid numbered lists unless they genuinely make the answer easier to scan.

Start with the core idea of the video in plain English. Then explain the most useful takeaways, what seems skippable or repetitive, and whether I should watch, skim, or skip it. End with one clean final takeaway.

If the transcript or metadata is incomplete, say what you can determine and what is uncertain. Do not invent details, quotes, timestamps, or claims.`,
      true,
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
