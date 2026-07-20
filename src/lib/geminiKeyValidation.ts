import type { GeminiKeyValidation, GeminiKeyValidationFailure } from "../types";
import { GEMINI_MODEL_ID } from "./constants";

export function categorizeKeyVerificationFailure(status?: number): GeminiKeyValidationFailure {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "model_unavailable";
  if (status === 429) return "quota_limited";
  if (status !== undefined && status >= 500) return "google_service";
  if (status !== undefined) return "rejected";
  return "network";
}

export function keyValidationMessage(validation: GeminiKeyValidation): string {
  if (validation.status === "valid") return "Verified for Gemini 3.1 Flash-Lite.";
  if (validation.status === "unverified") return "Saved locally, but not verified yet.";
  switch (validation.failureCategory) {
    case "unauthorized":
      return "Google rejected this key. Check that it is active and its API restrictions allow the Gemini API.";
    case "model_unavailable":
      return "Gemini 3.1 Flash-Lite is not available to this Google project.";
    case "quota_limited":
      return "Google rate-limited verification. Wait briefly, then retry.";
    case "google_service":
      return "Google's API is temporarily unavailable. Retry in a moment.";
    case "rejected":
      return "Google rejected the verification request. Review the key and project settings.";
    case "network":
    default:
      return "TL;DW could not reach Google's API. Check your connection and retry.";
  }
}

export async function verifyGeminiKey(
  apiKey: string,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
): Promise<GeminiKeyValidation> {
  const verifiedAt = now.toISOString();
  try {
    const response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}`,
      { headers: { "x-goog-api-key": apiKey } },
    );
    return response.ok
      ? { status: "valid", verifiedAt }
      : {
          status: "invalid",
          verifiedAt,
          failureCategory: categorizeKeyVerificationFailure(response.status),
        };
  } catch {
    return {
      status: "invalid",
      verifiedAt,
      failureCategory: categorizeKeyVerificationFailure(),
    };
  }
}
