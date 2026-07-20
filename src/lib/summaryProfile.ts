import type { PromptProfile, Settings, SummarySource } from "../types";

/**
 * Select the profile whose template will actually be sent for a summary run.
 * Keeping this decision in one place prevents prompt, history, logging, and
 * cache metadata from disagreeing about the active profile.
 */
export function selectSummaryProfile(
  profiles: PromptProfile[],
  settings: Settings,
  source: SummarySource,
  requestedProfileId: string | undefined,
  willUseDirectApi: boolean,
): PromptProfile | undefined {
  let effectiveId = requestedProfileId;

  if (source === "page") {
    effectiveId = settings.defaultProfileId;
  } else if (source === "auto" && willUseDirectApi) {
    effectiveId = settings.directApiProfileId ?? settings.defaultProfileId;
  } else if (source === "popup-inline") {
    effectiveId = requestedProfileId ?? settings.defaultProfileId;
  }

  return (
    profiles.find((profile) => profile.id === effectiveId) ??
    profiles.find((profile) => profile.id === settings.defaultProfileId) ??
    profiles[0]
  );
}
