import { describe, expect, it } from "vitest";
import {
  emptyGeminiUsage,
  geminiQuotaDay,
  migrateGeminiUsage,
  recordUsageAttempt,
  recordUsageOutcome,
} from "./geminiUsage";

describe("Gemini usage quota days", () => {
  it("rolls over at Pacific midnight in standard time", () => {
    expect(geminiQuotaDay(new Date("2026-01-02T07:59:59Z"))).toBe("2026-01-01");
    expect(geminiQuotaDay(new Date("2026-01-02T08:00:00Z"))).toBe("2026-01-02");
  });

  it("rolls over at Pacific midnight in daylight time", () => {
    expect(geminiQuotaDay(new Date("2026-07-02T06:59:59Z"))).toBe("2026-07-01");
    expect(geminiQuotaDay(new Date("2026-07-02T07:00:00Z"))).toBe("2026-07-02");
  });

  it("migrates legacy successful calls as attempts and successes", () => {
    const usage = migrateGeminiUsage({
      totalCalls: 12,
      allTimeCalls: 30,
      todayCalls: 4,
      todayDate: "2026-07-20",
      lastCalledAt: "2026-07-20T12:00:00Z",
    }, new Date("2026-07-20T12:00:00Z"));
    expect(usage).toMatchObject({
      version: 2,
      attemptsToday: 4,
      successesToday: 4,
      attemptsSinceClear: 12,
      successesSinceClear: 12,
      allTimeAttempts: 30,
    });
  });

  it("preserves lifetime data but resets a stale quota day", () => {
    const usage = migrateGeminiUsage({
      version: 2,
      quotaDay: "2026-07-19",
      attemptsToday: 9,
      successesToday: 8,
      failuresToday: 1,
      attemptsSinceClear: 20,
      successesSinceClear: 18,
      failuresSinceClear: 2,
      allTimeAttempts: 50,
    }, new Date("2026-07-20T12:00:00Z"));
    expect(usage.attemptsToday).toBe(0);
    expect(usage.attemptsSinceClear).toBe(20);
    expect(usage.allTimeAttempts).toBe(50);
  });

  it("counts failed attempts in the quota meter and all-time total", () => {
    const at = new Date("2026-07-20T12:00:00Z");
    const attempted = recordUsageAttempt(emptyGeminiUsage("2026-07-20"), at);
    const failed = recordUsageOutcome(attempted, "failure", at, at);
    expect(failed).toMatchObject({
      attemptsToday: 1,
      failuresToday: 1,
      successesToday: 0,
      allTimeAttempts: 1,
    });
  });
});
