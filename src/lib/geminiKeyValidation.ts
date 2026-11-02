import type { GeminiKeyValidation, GeminiKeyValidationFailure } from "../types";
import { DEFAULT_GEMINI_MODEL_ID, geminiModelLabel } from "./constants";
import { geminiErrorMessage } from "./geminiApi";

export function categorizeKeyVerificationFailure(status?: number): GeminiKeyValidationFailure {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "model_unavailable";
  if (status === 429) return "quota_limited";
  if (status !== undefined && status >= 500) return "google_service";
  if (status !== undefined) return "rejected";
  return "network";
}

export function keyValidationMessage(
  validation: GeminiKeyValidation,
  model: string = DEFAULT_GEMINI_MODEL_ID,
): string {
  if (validation.status === "valid") return `Verified for ${geminiModelLabel(model)}.`;
  if (validation.status === "unverified") return "Saved locally, but not verified yet.";
  switch (validation.failureCategory) {
    case "unauthorized":
      // Shown in TL;DW's own settings, next to the key: say what to do here.
      return "Google rejected this API key. Delete it and paste a working key, or check its restrictions in AI Studio.";
    case "model_unavailable":
      return geminiErrorMessage("model_unavailable");
    case "quota_limited":
      return geminiErrorMessage("quota_limited");
    case "google_service":
      return geminiErrorMessage("google_service");
    case "rejected":
      return "Google rejected the verification request. Review the key and project settings.";
    case "network":
    default:
      return geminiErrorMessage("network");
  }
}

export async function verifyGeminiKey(
  apiKey: string,
  fetcher: typeof fetch = fetch,
  now: Date = new Date(),
  model: string = DEFAULT_GEMINI_MODEL_ID,
): Promise<GeminiKeyValidation> {
  const verifiedAt = now.toISOString();
  try {
    const response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}`,
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
