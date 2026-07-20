import { AI_STUDIO_LINKS, GEMINI_MODEL_ID } from "./constants";

const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_GEMINI_TIMEOUT_MS) || 60_000;

export type GeminiErrorCategory =
  | "invalid_request"
  | "unauthorized"
  | "model_unavailable"
  | "quota_limited"
  | "google_service"
  | "timeout"
  | "network"
  | "malformed_response";

const ERROR_COPY: Record<GeminiErrorCategory, string> = {
  invalid_request: "Gemini rejected the request or prompt. Try a shorter transcript or a different profile.",
  unauthorized: "Google rejected this API key. Check the key and its Gemini API restrictions in AI Studio.",
  model_unavailable: "Gemini 3.1 Flash-Lite is unavailable to this Google project. Check the project in AI Studio.",
  quota_limited: "The Gemini rate or quota limit was reached. Check usage in AI Studio, then retry later.",
  google_service: "Google's Gemini service is temporarily unavailable. Retry in a moment.",
  timeout: "The request exceeded TL;DW's 60-second timeout. Check your connection and retry.",
  network: "TL;DW could not reach Google's Gemini API. Check your connection and retry.",
  malformed_response: "Gemini returned a response TL;DW could not read. Retry the summary.",
};

export function geminiErrorMessage(category: string): string {
  return ERROR_COPY[category as GeminiErrorCategory] ?? ERROR_COPY.network;
}

export class GeminiApiError extends Error {
  constructor(
    public readonly category: GeminiErrorCategory,
    public readonly httpStatus?: number,
    public readonly actionUrl?: string,
    googleMessage?: string,
  ) {
    super(`${ERROR_COPY[category]}${googleMessage ? ` Google says: ${googleMessage}` : ""}`);
    this.name = "GeminiApiError";
  }
}

function safeGoogleMessage(message: unknown, apiKey: string): string | undefined {
  if (typeof message !== "string") return undefined;
  const value = message.trim();
  if (!value || value.length > 240 || value.includes("\n") || value.includes(apiKey)) return undefined;
  if (/transcript|x-goog-api-key|contents\s*[:=]|prompt\s*[:=]/i.test(value)) return undefined;
  return value;
}

export function geminiErrorForStatus(
  status: number,
  googleMessage?: unknown,
  apiKey = "",
): GeminiApiError {
  const safeMessage = safeGoogleMessage(googleMessage, apiKey);
  if (status === 400) return new GeminiApiError("invalid_request", status, undefined, safeMessage);
  if (status === 401 || status === 403) {
    return new GeminiApiError("unauthorized", status, AI_STUDIO_LINKS.apiKeys, safeMessage);
  }
  if (status === 404) {
    return new GeminiApiError("model_unavailable", status, AI_STUDIO_LINKS.apiKeys, safeMessage);
  }
  if (status === 429) {
    return new GeminiApiError("quota_limited", status, AI_STUDIO_LINKS.usage, safeMessage);
  }
  if (status >= 500 && status <= 599) {
    return new GeminiApiError("google_service", status, AI_STUDIO_LINKS.usage, safeMessage);
  }
  return new GeminiApiError("invalid_request", status, undefined, safeMessage);
}

export async function callGeminiApi(
  prompt: string,
  apiKey: string,
  options: { fetcher?: typeof fetch; timeoutMs?: number } = {},
): Promise<string> {
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  try {
    const response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_MODEL_ID}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.4, maxOutputTokens: 4096 },
        }),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
      throw geminiErrorForStatus(response.status, body?.error?.message, apiKey);
    }
    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = data?.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    if (!text) throw new GeminiApiError("malformed_response");
    return text;
  } catch (error) {
    if (error instanceof GeminiApiError) throw error;
    if (controller.signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
      throw new GeminiApiError("timeout");
    }
    throw new GeminiApiError("network");
  } finally {
    clearTimeout(timer);
  }
}

export function normalizeGeminiError(error: unknown): GeminiApiError {
  return error instanceof GeminiApiError ? error : new GeminiApiError("network");
}
