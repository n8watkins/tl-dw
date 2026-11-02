import { afterEach, describe, expect, it, vi } from "vitest";
import { callGeminiApi, geminiErrorForStatus, geminiRequestBody, summarizeWithFallback } from "./geminiApi";

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

  it("treats Google's 400 for an invalid key as a key problem, with the AI Studio link", async () => {
    // What generateContent answers for a key that doesn't exist (2026-11-02).
    const fetcher = async () => new Response(JSON.stringify({
      error: {
        code: 400,
        message: "API key not valid. Please pass a valid API key.",
        status: "INVALID_ARGUMENT",
        details: [{ "@type": "type.googleapis.com/google.rpc.ErrorInfo", reason: "API_KEY_INVALID", domain: "googleapis.com" }],
      },
    }), { status: 400 });
    const error = await callGeminiApi("prompt", "bad-key", { fetcher: fetcher as typeof fetch }).catch((e) => e);
    expect(error).toMatchObject({ category: "unauthorized", httpStatus: 400 });
    expect(error.actionUrl).toBeTruthy();
    expect(error.message).not.toContain("shorter transcript");
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

  it("treats a refused video as a video problem, but a key reason as a key problem", () => {
    expect(geminiErrorForStatus(400, undefined, "", undefined, { video: true }).category).toBe("video_unavailable");
    expect(geminiErrorForStatus(403, undefined, "", undefined, { video: true }).category).toBe("video_unavailable");
    expect(geminiErrorForStatus(403, undefined, "", "API_KEY_SERVICE_BLOCKED", { video: true }).category)
      .toBe("unauthorized");
    expect(geminiErrorForStatus(400, undefined, "", "API_KEY_INVALID", { video: true }).category).toBe("unauthorized");
    expect(geminiErrorForStatus(400).category).toBe("invalid_request");
  });

  it("marks a per-day quota 429", async () => {
    const fetcher = async () => new Response(JSON.stringify({
      error: {
        code: 429,
        status: "RESOURCE_EXHAUSTED",
        details: [{
          "@type": "type.googleapis.com/google.rpc.QuotaFailure",
          violations: [{ quotaId: "GenerateRequestsPerDayPerProjectPerModel-FreeTier" }],
        }],
      },
    }), { status: 429 });
    const error = await callGeminiApi("p", "k", { fetcher: fetcher as typeof fetch }).catch((e) => e);
    expect(error).toMatchObject({ category: "quota_limited", dailyQuota: true });
  });
});

describe("Gemini requests", () => {
  it("sends text alone for a transcript prompt", () => {
    expect(geminiRequestBody({ prompt: "hello" })).toEqual({
      contents: [{ parts: [{ text: "hello" }] }],
      generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
    });
  });

  it("sends the YouTube URL as video input at low media resolution", () => {
    const body = geminiRequestBody({ prompt: "sum", videoUrl: "https://www.youtube.com/watch?v=abc" }) as {
      contents: { parts: unknown[] }[];
      generationConfig: Record<string, unknown>;
    };
    expect(body.contents[0].parts).toEqual([
      { fileData: { fileUri: "https://www.youtube.com/watch?v=abc" } },
      { text: "sum" },
    ]);
    expect(body.generationConfig.mediaResolution).toBe("MEDIA_RESOLUTION_LOW");
  });

  it("calls the chosen model", async () => {
    const urls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      urls.push(String(input));
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: "a" }, { text: "b" }] } }] }));
    };
    await expect(callGeminiApi("p", "k", { fetcher: fetcher as typeof fetch, model: "gemini-3.6-flash" }))
      .resolves.toBe("ab");
    expect(urls[0]).toContain("/models/gemini-3.6-flash:generateContent");
  });
});

describe("model fallback", () => {
  const ok = (text: string) => new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }));
  const limited = () => new Response(JSON.stringify({ error: { code: 429 } }), { status: 429 });

  it("retries once on 3.1 Flash-Lite when 3.5 Flash-Lite is rate limited", async () => {
    const models: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      const model = String(input).match(/models\/([^:]+):/)![1];
      models.push(model);
      return model === "gemini-3.5-flash-lite" ? limited() : ok("from fallback");
    };
    let notified = 0;
    const result = await summarizeWithFallback({ prompt: "p" }, "k", "gemini-3.5-flash-lite", {
      fetcher: fetcher as typeof fetch,
      onFallback: () => { notified++; },
    });
    expect(models).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
    expect(result).toEqual({ text: "from fallback", model: "gemini-3.1-flash-lite", fellBackFrom: "gemini-3.5-flash-lite" });
    expect(notified).toBe(1);
  });

  it("goes straight to the fallback once the default's daily quota is known to be spent", async () => {
    const models: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => {
      models.push(String(input).match(/models\/([^:]+):/)![1]);
      return ok("x");
    };
    await summarizeWithFallback({ prompt: "p" }, "k", "gemini-3.5-flash-lite", {
      fetcher: fetcher as typeof fetch,
      skipDefault: true,
    });
    expect(models).toEqual(["gemini-3.1-flash-lite"]);
  });

  it("does not fall back from a model the user picked, or on other errors", async () => {
    const calls: string[] = [];
    const fetcher = async (input: RequestInfo | URL) => { calls.push(String(input)); return limited(); };
    await expect(summarizeWithFallback({ prompt: "p" }, "k", "gemini-3.6-flash", { fetcher: fetcher as typeof fetch }))
      .rejects.toMatchObject({ category: "quota_limited" });
    expect(calls).toHaveLength(1);
    const unauthorized = async () => new Response("{}", { status: 401 });
    await expect(summarizeWithFallback({ prompt: "p" }, "k", "gemini-3.5-flash-lite", { fetcher: unauthorized as typeof fetch }))
      .rejects.toMatchObject({ category: "unauthorized" });
  });
});
