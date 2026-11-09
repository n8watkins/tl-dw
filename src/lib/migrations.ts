import { destinationLabel } from "./constants";
import { createDefaultProfiles, DEFAULT_PROFILE_ID } from "./profiles";
import type { PromptProfile, Settings, Tag } from "../types";

/**
 * TL;DW became Gemini-only in 1.4 (docs/DECISIONS.md). A user whose default
 * was ChatGPT, Claude or NotebookLM moves to Gemini, and the popup tells them
 * once, naming the site they had picked. Returns null when nothing changes.
 */
export function migrateToGeminiOnly(settings: Settings): Settings | null {
  if (!settings.destinationId || settings.destinationId === "gemini") return null;
  return {
    ...settings,
    destinationId: "gemini",
    retiredDestinationNotice: destinationLabel(settings.destinationId),
  };
}

/** The built-in names before 1.4, renamed when the user kept them. */
const OLD_BUILT_IN_NAMES: Record<string, string> = {
  tldw: "TL;DW",
  research: "Research Mode",
  learning: "Learning Mode",
  tutorial: "Tutorial Mode",
};

const RETIRED_PROFILE_ID = "moment-finder";

/**
 * Bring stored profiles up to 1.4, where each built-in has its own layout and
 * Moment Finder is gone (times now come with any profile, when the transcript
 * has them and they check out). A built-in the user never edited takes the new
 * version; an edited one keeps its wording and gets its layout. An unedited
 * Moment Finder is removed and anyone using it moves to Quick; an edited one
 * stays as the user's own profile. A built-in the user deleted stays deleted.
 * Idempotent; returns null when nothing changes.
 */
export function migrateProfiles(
  profiles: PromptProfile[],
  settings: Settings,
): { profiles: PromptProfile[]; settings: Settings } | null {
  const defaults = new Map(createDefaultProfiles().map((p) => [p.id, p]));
  let changed = false;
  const next: PromptProfile[] = [];
  for (const profile of profiles) {
    if (profile.id === RETIRED_PROFILE_ID) {
      changed = true;
      if (profile.isCustomized) next.push({ ...profile, isDefault: false, layout: profile.layout ?? "quick" });
      continue;
    }
    const builtIn = defaults.get(profile.id);
    if (!builtIn) {
      next.push(profile);
      continue;
    }
    const updated: PromptProfile = profile.isCustomized
      ? {
          ...profile,
          layout: builtIn.layout,
          name: profile.name === OLD_BUILT_IN_NAMES[profile.id] ? builtIn.name : profile.name,
          description: builtIn.description,
        }
      : { ...builtIn, createdAt: profile.createdAt, updatedAt: profile.updatedAt };
    if (
      updated.promptTemplate !== profile.promptTemplate ||
      updated.name !== profile.name ||
      updated.layout !== profile.layout ||
      updated.description !== profile.description
    ) changed = true;
    next.push(updated);
  }
  const ids = new Set(next.map((p) => p.id));
  const fallback = ids.has(DEFAULT_PROFILE_ID) ? DEFAULT_PROFILE_ID : next[0]?.id;
  const nextSettings = { ...settings };
  if (settings.defaultProfileId && !ids.has(settings.defaultProfileId)) {
    nextSettings.defaultProfileId = fallback;
    changed = true;
  }
  if (settings.directApiProfileId && !ids.has(settings.directApiProfileId)) {
    nextSettings.directApiProfileId = fallback;
    changed = true;
  }
  return changed ? { profiles: next, settings: nextSettings } : null;
}

/**
 * Tags became labels in 1.4, and a channel got a default style instead. A
 * channel whose tag is named after a profile ("Tutorial", "research") gets
 * that profile as its style, unless it has one already or its tags name two
 * different profiles. Returns the new channel -> profile map, or null when
 * nothing changes.
 */
export function stylesFromTags(
  library: Tag[],
  channelTags: Record<string, string[]>,
  profiles: PromptProfile[],
  channelProfiles: Record<string, string>,
): Record<string, string> | null {
  const byName = new Map(profiles.map((p) => [p.name.trim().toLowerCase(), p.id]));
  // The old built-in names point at their profiles too ("Tutorial Mode" -> Tutorial).
  for (const [id, old] of Object.entries(OLD_BUILT_IN_NAMES)) {
    if (profiles.some((p) => p.id === id)) byName.set(old.toLowerCase(), id);
  }
  const labelById = new Map(library.map((t) => [t.id, t.label.trim().toLowerCase()]));
  const next = { ...channelProfiles };
  let changed = false;
  for (const [channel, ids] of Object.entries(channelTags)) {
    if (next[channel]) continue;
    const matches = new Set(ids.map((id) => byName.get(labelById.get(id) ?? "")).filter((id): id is string => !!id));
    if (matches.size !== 1) continue;
    next[channel] = [...matches][0]!;
    changed = true;
  }
  return changed ? next : null;
}
