import { describe, expect, it } from "vitest";
import { categorizeKeyVerificationFailure, keyValidationMessage, verifyGeminiKey } from "./geminiKeyValidation";

describe("Gemini key validation", () => {
  it.each([
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "model_unavailable"],
    [429, "quota_limited"],
    [503, "google_service"],
    [400, "rejected"],
    [undefined, "network"],
  ] as const)("maps status %s to %s", (status, category) => {
    expect(categorizeKeyVerificationFailure(status)).toBe(category);
  });

  it("provides an actionable invalid-key message", () => {
    expect(keyValidationMessage({ status: "invalid", failureCategory: "unauthorized" }))
      .toContain("API restrictions");
  });

  it("verifies against model metadata with the key in a header", async () => {
    const fetcher = async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(String(input)).toContain("/models/gemini-3.1-flash-lite");
      expect(init?.headers).toEqual({ "x-goog-api-key": "secret" });
      return new Response("{}", { status: 200 });
    };
    await expect(verifyGeminiKey("secret", fetcher as typeof fetch, new Date("2026-07-20T12:00:00Z")))
      .resolves.toEqual({ status: "valid", verifiedAt: "2026-07-20T12:00:00.000Z" });
  });

  it("persists a sanitized failure category without response content", async () => {
    const fetcher = async () => new Response(JSON.stringify({ error: { message: "secret detail" } }), { status: 403 });
    const validation = await verifyGeminiKey("secret", fetcher as typeof fetch);
    expect(validation).toMatchObject({ status: "invalid", failureCategory: "unauthorized" });
    expect(JSON.stringify(validation)).not.toContain("secret detail");
  });
});
