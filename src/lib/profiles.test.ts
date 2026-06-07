import { describe, expect, it } from "vitest";
import { mergeImportedProfiles, nextAvailableName, normalizeName } from "./profiles";
import type { PromptProfile } from "../types";

function existing(name: string): PromptProfile {
  return {
    id: `id-${name}`,
    name,
    promptTemplate: "x",
    createdAt: "2026-01-01",
    updatedAt: "2026-01-01",
  };
}

// Deterministic id generator + timestamp for stable assertions.
function ids() {
  let n = 0;
  return () => `new-${n++}`;
}
const TS = "2026-06-06T00:00:00.000Z";

describe("normalizeName", () => {
  it("collapses whitespace and trims", () => {
    expect(normalizeName("  Deep   Dive  ")).toBe("Deep Dive");
  });
});

describe("nextAvailableName", () => {
  it("returns the base name when free", () => {
    expect(nextAvailableName([existing("Research")], "Learning")).toBe("Learning");
  });

  it("suffixes a number on a case-insensitive clash", () => {
    expect(nextAvailableName([existing("Research")], "research")).toBe("research (2)");
  });
});

describe("mergeImportedProfiles", () => {
  it("rejects input that is neither an array nor an envelope", () => {
    const r = mergeImportedProfiles([], { nope: true });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no profiles/i);
  });

  it("imports from a bare array", () => {
    const r = mergeImportedProfiles([], [{ name: "A", promptTemplate: "t" }], ids(), TS);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.added).toBe(1);
      expect(r.profiles[0]).toMatchObject({ name: "A", promptTemplate: "t", id: "new-0", createdAt: TS });
    }
  });

  it("imports from a { profiles: [...] } envelope", () => {
    const r = mergeImportedProfiles([], { profiles: [{ name: "A", promptTemplate: "t" }] }, ids(), TS);
    expect(r.ok && r.added).toBe(1);
  });

  it("skips invalid entries and counts them", () => {
    const r = mergeImportedProfiles(
      [],
      [
        { name: "Good", promptTemplate: "t" },
        { name: "no template" },
        { promptTemplate: "no name" },
        null,
        "string",
      ],
      ids(),
      TS,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.added).toBe(1);
      expect(r.skipped).toBe(4);
    }
  });

  it("errors when nothing valid is present", () => {
    const r = mergeImportedProfiles([], [{ name: "no template" }]);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/no valid profiles/i);
  });

  it("renames imports that clash with existing names", () => {
    const r = mergeImportedProfiles([existing("Research")], [{ name: "Research", promptTemplate: "t" }], ids(), TS);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.profiles[1].name).toBe("Research (2)");
  });

  it("never inherits isDefault or isCustomized from the source", () => {
    const r = mergeImportedProfiles(
      [],
      [{ name: "A", promptTemplate: "t", isDefault: true, isCustomized: true }],
      ids(),
      TS,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.profiles[0].isDefault).toBeUndefined();
      expect(r.profiles[0].isCustomized).toBeUndefined();
    }
  });
});
