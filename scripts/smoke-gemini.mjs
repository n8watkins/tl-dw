/**
 * Live check of the Gemini models TL;DW uses, against the real API.
 * Needs GEMINI_API_KEY in the environment and skips itself without it, so it
 * never runs in CI. The key is sent only in the x-goog-api-key header and is
 * never printed.
 *
 *   pass-env run -- npm run smoke:gemini      (names in .env.pass)
 *   GEMINI_API_KEY=... npm run smoke:gemini
 */
/* global fetch */
const key = process.env.GEMINI_API_KEY?.trim();
if (!key) {
  console.log("[smoke:gemini] GEMINI_API_KEY is not set; skipping the live check.");
  process.exit(0);
}

const BASE = "https://generativelanguage.googleapis.com/v1beta";
const MODELS = ["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"];
// A 19-second public video ("Me at the zoo"), so the video check costs little.
const VIDEO_URL = "https://www.youtube.com/watch?v=jNQXAC9IVRw";
const headers = { "Content-Type": "application/json", "x-goog-api-key": key };
let failed = false;

async function call(label, url, init) {
  const started = Date.now();
  const res = await fetch(url, { headers, ...init });
  const body = await res.json().catch(() => null);
  const ms = Date.now() - started;
  if (!res.ok) {
    failed = true;
    console.log(`FAIL ${label}: HTTP ${res.status} ${body?.error?.status ?? ""} ${body?.error?.message ?? ""} (${ms} ms)`);
    return null;
  }
  console.log(`ok   ${label} (${ms} ms)`);
  return body;
}

const list = await call("list models", `${BASE}/models?pageSize=1000`, { method: "GET" });
const names = new Set((list?.models ?? []).map((m) => String(m.name).replace(/^models\//, "")));
for (const id of MODELS) {
  if (names.has(id)) console.log(`ok   ${id} is listed`);
  else { failed = true; console.log(`FAIL ${id} is not in the models list`); }
}

for (const id of MODELS) {
  const text = await call(`${id}: text`, `${BASE}/models/${id}:generateContent`, {
    method: "POST",
    body: JSON.stringify({
      contents: [{ parts: [{ text: "Reply with the single word: ready" }] }],
      generationConfig: { maxOutputTokens: 16 },
    }),
  });
  if (text) console.log(`     -> ${JSON.stringify(text.candidates?.[0]?.content?.parts?.[0]?.text ?? "").slice(0, 60)}`);
}

const video = await call(`${MODELS[0]}: YouTube video input, low media resolution`, `${BASE}/models/${MODELS[0]}:generateContent`, {
  method: "POST",
  body: JSON.stringify({
    contents: [{ parts: [{ fileData: { fileUri: VIDEO_URL } }, { text: "In one sentence, what happens in this video?" }] }],
    generationConfig: { maxOutputTokens: 128, mediaResolution: "MEDIA_RESOLUTION_LOW" },
  }),
});
if (video) {
  console.log(`     -> ${JSON.stringify(video.candidates?.[0]?.content?.parts?.[0]?.text ?? "").slice(0, 160)}`);
  console.log(`     tokens: ${JSON.stringify(video.usageMetadata ?? {})}`);
}

process.exit(failed ? 1 : 0);
