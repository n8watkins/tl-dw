import { describe, expect, it } from "vitest";
import { trimActivity } from "./storage";

// ---------------------------------------------------------------------------
// trimActivity — bounds the summary-activity heatmap's daily-counts map
// ---------------------------------------------------------------------------

describe("trimActivity — trim to the newest maxKeys dates", () => {
  it("returns the same object when at or below the cap", () => {
    const activity: Record<string, number> = { "2025-01-01": 1, "2025-01-02": 2 };
    const result = trimActivity(activity, 366);
    expect(Object.keys(result)).toHaveLength(2);
  });

  it("trims to the newest maxKeys dates when over the cap", () => {
    // Build 370 keys spanning 2024-01-01 through 2025-01-04 (days 0-369).
    const activity: Record<string, number> = {};
    for (let i = 0; i < 370; i++) {
      const d = new Date("2024-01-01");
      d.setDate(d.getDate() + i);
      activity[d.toISOString().slice(0, 10)] = i + 1;
    }
    const result = trimActivity(activity, 366);
    const keys = Object.keys(result).sort();
    expect(keys).toHaveLength(366);
    // The 4 oldest (2024-01-01 … 2024-01-03) should be gone; first kept is 2024-01-04.
    expect(keys[0]).toBe("2024-01-04");
    // The newest key is still present.
    expect(keys[365]).toBe("2025-01-04");
  });

  it("uses 400 as the default cap (covers the 53-week heatmap window)", () => {
    const activity: Record<string, number> = {};
    for (let i = 0; i < 450; i++) {
      const d = new Date("2024-01-01");
      d.setDate(d.getDate() + i);
      activity[d.toISOString().slice(0, 10)] = 1;
    }
    const result = trimActivity(activity);
    expect(Object.keys(result)).toHaveLength(400);
  });

  it("keeps values intact for retained keys", () => {
    const activity: Record<string, number> = { "2025-12-31": 42, "2025-12-30": 7 };
    const result = trimActivity(activity, 2);
    expect(result["2025-12-31"]).toBe(42);
    expect(result["2025-12-30"]).toBe(7);
  });
});
