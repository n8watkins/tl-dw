import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "./constants";
import { migrateProfiles, migrateToGeminiOnly, stylesFromTags } from "./migrations";
import type { PromptProfile } from "../types";

describe("migrateToGeminiOnly", () => {
  it("moves a ChatGPT, Claude or NotebookLM default to Gemini and keeps the name for a one-time note", () => {
    expect(migrateToGeminiOnly({ ...DEFAULT_SETTINGS, destinationId: "chatgpt" })).toMatchObject({
      destinationId: "gemini",
      retiredDestinationNotice: "ChatGPT",
    });
    expect(migrateToGeminiOnly({ ...DEFAULT_SETTINGS, destinationId: "notebooklm" })?.retiredDestinationNotice).toBe("NotebookLM");
  });

  it("leaves a Gemini user alone, so the note shows only once", () => {
    expect(migrateToGeminiOnly({ ...DEFAULT_SETTINGS, destinationId: "gemini" })).toBeNull();
    expect(migrateToGeminiOnly({ ...DEFAULT_SETTINGS, destinationId: "gemini", retiredDestinationNotice: "Claude" })).toBeNull();
  });
});

describe("migrateProfiles", () => {
  const ts = "2026-01-01T00:00:00.000Z";
  const old = (id: string, name: string, extra: Partial<PromptProfile> = {}): PromptProfile => ({
    id, name, promptTemplate: `old ${id} template`, isDefault: true, createdAt: ts, updatedAt: ts, ...extra,
  });
  const before = [
    old("tldw", "TL;DW"),
    old("research", "Research Mode", { isCustomized: true, promptTemplate: "my research prompt" }),
    old("learning", "Learning Mode"),
    old("moment-finder", "Moment Finder"),
    { id: "mine", name: "Mine", promptTemplate: "custom", createdAt: ts, updatedAt: ts },
  ];

  it("gives unedited built-ins the new version and its layout, and keeps edits", () => {
    const result = migrateProfiles(before, { ...DEFAULT_SETTINGS, defaultProfileId: "tldw" })!;
    const byId = new Map(result.profiles.map((p) => [p.id, p]));
    expect(byId.get("tldw")).toMatchObject({ name: "Quick", layout: "quick", createdAt: ts });
    expect(byId.get("tldw")!.promptTemplate).not.toContain("old");
    expect(byId.get("research")).toMatchObject({ name: "Research", layout: "research", promptTemplate: "my research prompt" });
    expect(byId.get("learning")).toMatchObject({ name: "Learning", layout: "learning" });
    expect(byId.get("mine")).toEqual(before[4]);
  });

  it("removes an unedited Moment Finder and moves its users to Quick", () => {
    const result = migrateProfiles(before, { ...DEFAULT_SETTINGS, defaultProfileId: "moment-finder", directApiProfileId: "moment-finder" })!;
    expect(result.profiles.map((p) => p.id)).not.toContain("moment-finder");
    expect(result.settings.defaultProfileId).toBe("tldw");
    expect(result.settings.directApiProfileId).toBe("tldw");
  });

  it("keeps an edited Moment Finder as the user's own profile", () => {
    const edited = before.map((p) => (p.id === "moment-finder" ? { ...p, isCustomized: true } : p));
    const kept = migrateProfiles(edited, DEFAULT_SETTINGS)!.profiles.find((p) => p.id === "moment-finder");
    expect(kept).toMatchObject({ isDefault: false, layout: "quick" });
  });

  it("leaves a deleted built-in deleted, and changes nothing the second time", () => {
    const first = migrateProfiles(before.filter((p) => p.id !== "learning"), DEFAULT_SETTINGS)!;
    expect(first.profiles.map((p) => p.id)).not.toContain("learning");
    expect(first.profiles.map((p) => p.id)).not.toContain("tutorial");
    expect(migrateProfiles(first.profiles, first.settings)).toBeNull();
  });
});

describe("stylesFromTags", () => {
  const ts = "2026-01-01T00:00:00.000Z";
  const profiles: PromptProfile[] = [
    { id: "tldw", name: "Quick", promptTemplate: "", createdAt: ts, updatedAt: ts },
    { id: "tutorial", name: "Tutorial", promptTemplate: "", createdAt: ts, updatedAt: ts },
    { id: "learning", name: "Learning", promptTemplate: "", createdAt: ts, updatedAt: ts },
  ];
  const library = [
    { id: "t1", label: "Tutorial", prompt: "Frame it as steps" },
    { id: "t2", label: "Citations", prompt: "Name the sources" },
    { id: "t3", label: "Learning Mode", prompt: "" },
  ];

  it("gives a channel the style its tag is named after, including the old built-in names", () => {
    expect(stylesFromTags(library, { "Cooking Pro": ["t1", "t2"], "MIT OCW": ["t3"] }, profiles, {})).toEqual({
      "Cooking Pro": "tutorial",
      "MIT OCW": "learning",
    });
  });

  it("keeps a style already set, skips a channel whose tags name two styles, and ignores other tags", () => {
    expect(stylesFromTags(library, { "Cooking Pro": ["t1"] }, profiles, { "Cooking Pro": "tldw" })).toBeNull();
    expect(stylesFromTags(library, { Mixed: ["t1", "t3"] }, profiles, {})).toBeNull();
    expect(stylesFromTags(library, { News: ["t2"] }, profiles, {})).toBeNull();
  });
});
