import { GEMINI_QUOTA_TIME_ZONE } from "./constants";
import type { GeminiUsage } from "../types";

export function geminiQuotaDay(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: GEMINI_QUOTA_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

export function emptyGeminiUsage(quotaDay = geminiQuotaDay()): GeminiUsage {
  return {
    version: 2,
    quotaDay,
    attemptsToday: 0,
    successesToday: 0,
    failuresToday: 0,
    attemptsSinceClear: 0,
    successesSinceClear: 0,
    failuresSinceClear: 0,
    allTimeAttempts: 0,
  };
}

export function migrateGeminiUsage(value: unknown, now = new Date()): GeminiUsage {
  const day = geminiQuotaDay(now);
  if (value && typeof value === "object" && (value as { version?: number }).version === 2) {
    const current = { ...emptyGeminiUsage(day), ...(value as GeminiUsage) };
    return current.quotaDay === day
      ? current
      : {
          ...current,
          quotaDay: day,
          attemptsToday: 0,
          successesToday: 0,
          failuresToday: 0,
        };
  }

  const legacy = (value ?? {}) as {
    totalCalls?: number;
    allTimeCalls?: number;
    todayCalls?: number;
    todayDate?: string;
    lastCalledAt?: string;
  };
  const todaySuccesses = legacy.todayDate === day ? legacy.todayCalls ?? 0 : 0;
  const sinceClear = legacy.totalCalls ?? 0;
  return {
    ...emptyGeminiUsage(day),
    attemptsToday: todaySuccesses,
    successesToday: todaySuccesses,
    attemptsSinceClear: sinceClear,
    successesSinceClear: sinceClear,
    allTimeAttempts: legacy.allTimeCalls ?? sinceClear,
    lastAttemptAt: legacy.lastCalledAt,
    lastSuccessAt: legacy.lastCalledAt,
  };
}

export function recordUsageAttempt(usage: GeminiUsage, now = new Date()): GeminiUsage {
  const current = migrateGeminiUsage(usage, now);
  return {
    ...current,
    attemptsToday: current.attemptsToday + 1,
    attemptsSinceClear: current.attemptsSinceClear + 1,
    allTimeAttempts: current.allTimeAttempts + 1,
    lastAttemptAt: now.toISOString(),
  };
}

export function recordUsageOutcome(
  usage: GeminiUsage,
  outcome: "success" | "failure",
  attemptAt: Date,
  now = new Date(),
): GeminiUsage {
  const current = migrateGeminiUsage(usage, now);
  const countsToday = geminiQuotaDay(attemptAt) === current.quotaDay;
  return {
    ...current,
    successesToday: current.successesToday + (outcome === "success" && countsToday ? 1 : 0),
    failuresToday: current.failuresToday + (outcome === "failure" && countsToday ? 1 : 0),
    successesSinceClear: current.successesSinceClear + (outcome === "success" ? 1 : 0),
    failuresSinceClear: current.failuresSinceClear + (outcome === "failure" ? 1 : 0),
    lastSuccessAt: outcome === "success" ? now.toISOString() : current.lastSuccessAt,
  };
}
