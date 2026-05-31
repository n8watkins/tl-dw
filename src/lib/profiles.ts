import type { PromptProfile } from "../types";

function now() {
  return new Date().toISOString();
}

/**
 * The built-in profiles seeded on first install. The first one (TLDR) is the
 * default. Templates support {{title}}, {{url}}, {{channel}}, {{date}}.
 */
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
      "tldr",
      "TLDR",
      "Quick summary and the main takeaway.",
      `Summarize this YouTube video: {{url}}

Give me a TLDR:
1. One-sentence summary
2. 5 bullet-point summary
3. Main argument or purpose
4. Key takeaways
5. Anything especially useful, surprising, or skippable
6. Final takeaway in one sentence`,
      true,
    ),
    base(
      "worth-watching",
      "Worth Watching?",
      "Decide whether to watch, skim, or skip.",
      `Analyze this YouTube video and help me decide if it is worth watching: {{url}}

1. Verdict: Watch / Skim / Skip
2. Score: 1-10
3. Best audience for this video
4. Main value
5. Likely filler or wasted time
6. What to pay attention to if I watch
7. What I can safely skip
8. Final recommendation`,
    ),
    base(
      "research",
      "Research Mode",
      "Extract claims, evidence, and things to verify.",
      `Analyze this YouTube video as research material: {{url}}

1. Main thesis or argument
2. Supporting claims
3. Evidence or examples mentioned
4. Assumptions being made
5. Weak points or missing context
6. Claims worth fact-checking
7. Counterarguments
8. Research value: High / Medium / Low`,
    ),
    base(
      "clip-ideas",
      "Clip Ideas",
      "Find short-form content opportunities.",
      `Analyze this YouTube video for short-form content opportunities: {{url}}

1. Best potential clip ideas
2. Strong hook ideas
3. Possible titles
4. Caption ideas
5. Moments likely to create curiosity or debate
6. Suggested angle for each clip
7. Timestamp guesses if you can infer them
8. Overall clip potential: High / Medium / Low`,
    ),
    base(
      "learning",
      "Learning Mode",
      "Turn the video into a study guide.",
      `Analyze this YouTube video as a learning resource and turn it into a study guide: {{url}}

1. Core concepts explained
2. Simple explanation for a beginner
3. Important terms and definitions
4. Examples or analogies
5. Prerequisite knowledge
6. Common misunderstandings
7. 5 quiz questions
8. Follow-up topics to study`,
    ),
  ];
}
