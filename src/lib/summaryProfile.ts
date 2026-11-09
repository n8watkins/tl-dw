import type { PromptProfile, Settings } from "../types";

/**
 * The profile a summary run uses: the one the user picked for this run (the
 * panel's Style menu, the popup or the right-click menu), else the channel's
 * default style, else the default profile. One decision in one place keeps the
 * prompt, history, call log and cache in agreement.
 */
export function selectSummaryProfile(
  profiles: PromptProfile[],
  settings: Settings,
  requestedProfileId: string | undefined,
  channelProfileId?: string,
): PromptProfile | undefined {
  const find = (id: string | undefined) => (id ? profiles.find((p) => p.id === id) : undefined);
  return find(requestedProfileId) ?? find(channelProfileId) ?? find(settings.defaultProfileId) ?? profiles[0];
}
