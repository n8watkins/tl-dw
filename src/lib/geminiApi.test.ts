import { afterEach, describe, expect, it, vi } from "vitest";
import { callGeminiApi, geminiErrorForStatus } from "./geminiApi";

describe("Gemini API errors", () => {
  afterEach(() => vi.useRealTimers());
  it.each([
    [400, "invalid_request"],
    [401, "unauthorized"],
    [403, "unauthorized"],
    [404, "model_unavailable"],
    [429, "quota_limited"],
    [500, "google_service"],
    [599, "google_service"],
  ] as const)("maps HTTP %s to %s", (status, category) => {
    expect(geminiErrorForStatus(status).category).toBe(category);
  });

  it("does not expose a key or unsafe response content", () => {
    const error = geminiErrorForStatus(403, "prompt: private transcript", "secret-key");
    expect(error.message).not.toContain("private transcript");
    expect(error.message).not.toContain("secret-key");
  });

  it("maps network failures", async () => {
    const fetcher = async () => { throw new TypeError("offline"); };
    await expect(callGeminiApi("private prompt", "secret", { fetcher: fetcher as typeof fetch }))
      .rejects.toMatchObject({ category: "network" });
  });

  it("rejects empty model output as malformed", async () => {
    const fetcher = async () => new Response(JSON.stringify({ candidates: [] }), { status: 200 });
    await expect(callGeminiApi("prompt", "secret", { fetcher: fetcher as typeof fetch }))
      .rejects.toMatchObject({ category: "malformed_response" });
  });

  it("returns model text for a successful response", async () => {
    const fetcher = async () => new Response(JSON.stringify({
      candidates: [{ content: { parts: [{ text: "summary" }] } }],
    }), { status: 200 });
    await expect(callGeminiApi("prompt", "secret", { fetcher: fetcher as typeof fetch }))
      .resolves.toBe("summary");
  });

  it("aborts and categorizes requests that exceed the timeout", async () => {
    vi.useFakeTimers();
    const fetcher = (_input: RequestInfo | URL, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")));
      });
    const request = callGeminiApi("prompt", "secret", {
      fetcher: fetcher as typeof fetch,
      timeoutMs: 100,
    });
    const expectation = expect(request).rejects.toMatchObject({ category: "timeout" });
    await vi.advanceTimersByTimeAsync(100);
    await expectation;
  });
});
