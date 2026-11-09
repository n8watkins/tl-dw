import {
  AI_STUDIO_LINKS,
  DEFAULT_GEMINI_MODEL_ID,
  FALLBACK_GEMINI_MODEL_ID,
  geminiModelLabel,
} from "./constants";

const DEFAULT_TIMEOUT_MS = Number(import.meta.env.VITE_GEMINI_TIMEOUT_MS) || 60_000;
/** Watching a video takes Gemini longer than reading a transcript. */
const VIDEO_TIMEOUT_MS = Number(import.meta.env.VITE_GEMINI_TIMEOUT_MS) || 150_000;

export type GeminiErrorCategory =
  | "invalid_request"
  | "unauthorized"
  | "model_unavailable"
  | "quota_limited"
  | "video_unavailable"
  | "google_service"
  | "timeout"
  | "network"
  | "malformed_response";

const ERROR_COPY: Record<GeminiErrorCategory, string> = {
  invalid_request: "Gemini rejected the request or prompt. Try again, or try a different profile.",
  unauthorized: "Google rejected this API key. Replace it in TL;DW settings, or check its restrictions in AI Studio.",
  model_unavailable: "The selected Gemini model isn't available to this key's project. Pick another model in TL;DW settings.",
  quota_limited: "The Gemini rate or quota limit was reached. Check usage in AI Studio, then retry later.",
  video_unavailable:
    "Gemini couldn't watch this video. It can only watch public YouTube videos: private, unlisted, " +
    "age-restricted and region-blocked videos don't work.",
  google_service: "Google's Gemini service is temporarily unavailable. Retry in a moment.",
  timeout: "Gemini took too long to answer. Check your connection and retry.",
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
    /** A 429 whose quota is a per-day one (it won't clear until the quota day ends). */
    public readonly dailyQuota = false,
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

type GoogleErrorDetail = { reason?: unknown; violations?: Array<{ quotaId?: unknown }> };

export function geminiErrorForStatus(
  status: number,
  googleMessage?: unknown,
  apiKey = "",
  googleReason?: string,
  opts: { video?: boolean; dailyQuota?: boolean } = {},
): GeminiApiError {
  const safeMessage = safeGoogleMessage(googleMessage, apiKey);
  // Google answers a key that doesn't exist with 400 INVALID_ARGUMENT and the
  // reason API_KEY_INVALID: a key problem, not a prompt problem.
  const badKey = googleReason === "API_KEY_INVALID";
  if (status === 401 || (status === 400 && badKey) || (status === 403 && googleReason?.startsWith("API_KEY"))) {
    return new GeminiApiError("unauthorized", status, AI_STUDIO_LINKS.apiKeys, safeMessage);
  }
  // A video Gemini can't fetch (private, age-restricted, removed) is refused
  // with 400 or 403; a key that works for text but not this video is not a key problem.
  if (opts.video && (status === 400 || status === 403)) {
    return new GeminiApiError("video_unavailable", status, undefined, safeMessage);
  }
  if (status === 403) {
    return new GeminiApiError("unauthorized", status, AI_STUDIO_LINKS.apiKeys, safeMessage);
  }
  if (status === 400) return new GeminiApiError("invalid_request", status, undefined, safeMessage);
  if (status === 404) {
    return new GeminiApiError("model_unavailable", status, AI_STUDIO_LINKS.apiKeys, safeMessage);
  }
  if (status === 429) {
    return new GeminiApiError("quota_limited", status, AI_STUDIO_LINKS.usage, safeMessage, !!opts.dailyQuota);
  }
  if (status >= 500 && status <= 599) {
    return new GeminiApiError("google_service", status, AI_STUDIO_LINKS.usage, safeMessage);
  }
  return new GeminiApiError("invalid_request", status, undefined, safeMessage);
}

/**
 * What to send. With `videoUrl`, Gemini watches the YouTube video itself
 * (public videos only) at low media resolution, which keeps a long video's
 * token count down; the prompt then carries no transcript.
 */
export type GeminiRequest = {
  prompt: string;
  videoUrl?: string;
  /** Watch only this stretch of the video (seconds), for a video too long for one request. */
  startSeconds?: number;
  endSeconds?: number;
};

export type GeminiCallOptions = {
  fetcher?: typeof fetch;
  timeoutMs?: number;
  model?: string;
};

export function geminiRequestBody(request: GeminiRequest): unknown {
  const clip = request.startSeconds !== undefined || request.endSeconds !== undefined
    ? {
        videoMetadata: {
          ...(request.startSeconds !== undefined ? { startOffset: `${Math.floor(request.startSeconds)}s` } : {}),
          ...(request.endSeconds !== undefined ? { endOffset: `${Math.ceil(request.endSeconds)}s` } : {}),
        },
      }
    : {};
  const parts: unknown[] = request.videoUrl
    ? [{ fileData: { fileUri: request.videoUrl }, ...clip }, { text: request.prompt }]
    : [{ text: request.prompt }];
  return {
    contents: [{ parts }],
    generationConfig: {
      temperature: 0.4,
      maxOutputTokens: 4096,
      ...(request.videoUrl ? { mediaResolution: "MEDIA_RESOLUTION_LOW" } : {}),
    },
  };
}

export async function callGeminiApi(
  request: string | GeminiRequest,
  apiKey: string,
  options: GeminiCallOptions = {},
): Promise<string> {
  const req: GeminiRequest = typeof request === "string" ? { prompt: request } : request;
  const model = options.model ?? DEFAULT_GEMINI_MODEL_ID;
  const fetcher = options.fetcher ?? fetch;
  const controller = new AbortController();
  const timeout = options.timeoutMs ?? (req.videoUrl ? VIDEO_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
        body: JSON.stringify(geminiRequestBody(req)),
        signal: controller.signal,
      },
    );
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as {
        error?: { message?: string; details?: GoogleErrorDetail[] };
      } | null;
      const details = Array.isArray(body?.error?.details) ? body!.error!.details! : [];
      const reason = details.find((detail) => typeof detail?.reason === "string")?.reason as string | undefined;
      const dailyQuota = details.some((detail) =>
        Array.isArray(detail?.violations) &&
        detail.violations.some((v) => typeof v?.quotaId === "string" && /PerDay/i.test(v.quotaId)));
      throw geminiErrorForStatus(response.status, body?.error?.message, apiKey, reason, {
        video: !!req.videoUrl,
        dailyQuota,
      });
    }
    const data = (await response.json()) as {
      candidates?: { content?: { parts?: { text?: string }[] } }[];
    };
    const text = (data?.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part?.text ?? "")
      .join("");
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

export type GeminiSummaryResult = {
  text: string;
  /** The model that answered. */
  model: string;
  /** Set when the default model was rate limited and the fallback answered. */
  fellBackFrom?: string;
};

/**
 * Call `model`; when it is the default model and Google answers 429, retry once
 * on the fallback model. `skipDefault` goes straight to the fallback (the
 * default's per-day quota is already known to be used up).
 */
export async function summarizeWithFallback(
  request: GeminiRequest,
  apiKey: string,
  model: string,
  options: Omit<GeminiCallOptions, "model"> & {
    skipDefault?: boolean;
    onFallback?: (error: GeminiApiError) => void | Promise<void>;
  } = {},
): Promise<GeminiSummaryResult> {
  const canFallBack = model === DEFAULT_GEMINI_MODEL_ID;
  if (canFallBack && options.skipDefault) {
    const text = await callGeminiApi(request, apiKey, { ...options, model: FALLBACK_GEMINI_MODEL_ID });
    return { text, model: FALLBACK_GEMINI_MODEL_ID, fellBackFrom: model };
  }
  try {
    return { text: await callGeminiApi(request, apiKey, { ...options, model }), model };
  } catch (error) {
    if (!canFallBack || !(error instanceof GeminiApiError) || error.category !== "quota_limited") throw error;
    await options.onFallback?.(error);
    const text = await callGeminiApi(request, apiKey, { ...options, model: FALLBACK_GEMINI_MODEL_ID });
    return { text, model: FALLBACK_GEMINI_MODEL_ID, fellBackFrom: model };
  }
}

/** One line telling the user the summary came from the fallback model. */
export function fallbackNotice(from: string, to: string): string {
  return `${geminiModelLabel(from)} hit its rate or quota limit, so TL;DW used ${geminiModelLabel(to)} for this summary.`;
}

export function normalizeGeminiError(error: unknown): GeminiApiError {
  return error instanceof GeminiApiError ? error : new GeminiApiError("network");
}
