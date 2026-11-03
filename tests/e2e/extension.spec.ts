import { expect, test, type BrowserContext, type Page, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

// `npm run test:e2e` builds a test build (short Gemini timeout) into dist-e2e/,
// so dist/ stays the production build that gets loaded unpacked.
const extensionPath = path.resolve("dist-e2e");
// The modern transcript panel's segment markup as YouTube rendered it on
// 2026-11-02: a visible clock, a screen-reader time label, then the text.
function modernSegment(clock: string, label: string, text: string): string {
  return `<transcript-segment-view-model class="ytwTranscriptSegmentViewModelHost">` +
    `<div aria-hidden="true" class="ytwTranscriptSegmentViewModelTimestamp">${clock}</div>` +
    `<div class="ytwTranscriptSegmentViewModelTimestampA11yLabel">${label}</div>` +
    `<span class="ytAttributedStringHost" role="text">${text}</span>` +
    `</transcript-segment-view-model>`;
}

const youtubeFixture = `<!doctype html>
<html>
  <head><title>Fixture Video - YouTube</title></head>
  <body>
    <ytd-watch-metadata>
      <div id="owner">
        <ytd-video-owner-renderer><a class="yt-simple-endpoint" href="/@FixtureChannel"><img alt=""></a></ytd-video-owner-renderer>
        <div id="channel-name"><a href="/@FixtureChannel">Fixture Channel</a></div>
        <div id="subscribe-button"></div>
      </div>
    </ytd-watch-metadata>
    <div id="below"></div>
    ${modernSegment("0:01", "1 second", "The fixture transcript explains reliable extension testing.")}
    ${modernSegment("0:05", "5 seconds", "It recommends prompt-aware caching and correct profile selection.")}
  </body>
</html>`;

// A watch page with no rendered transcript: its "Show transcript" button loads
// the panel through get_panel, as current YouTube does.
const getPanelFixture = `<!doctype html>
<html>
  <head><title>Panel Video - YouTube</title></head>
  <body>
    <ytd-watch-metadata>
      <div id="owner">
        <div id="channel-name"><a href="/@FixtureChannel">Fixture Channel</a></div>
        <div id="subscribe-button"></div>
      </div>
    </ytd-watch-metadata>
    <div id="below"></div>
    <ytd-video-description-transcript-section-renderer>
      <button onclick="fetch('/youtubei/v1/get_panel?prettyPrint=false', { method: 'POST', body: '{}' })">Show transcript</button>
    </ytd-video-description-transcript-section-renderer>
  </body>
</html>`;

function getPanelBody(videoId: string): string {
  const segment = (seconds: number, text: string) => ({
    macroMarkersPanelItemViewModel: {
      item: {
        timelineItemViewModel: {
          timestamp: `0:${String(seconds).padStart(2, "0")}`,
          contentItems: [{
            transcriptSegmentViewModel: {
              simpleText: text,
              timestamp: `0:${String(seconds).padStart(2, "0")}`,
              timestampA11yLabel: `${seconds} seconds`,
            },
          }],
        },
      },
      onTap: { innertubeCommand: { watchEndpoint: { videoId, startTimeSeconds: seconds } } },
    },
  });
  return JSON.stringify({
    content: {
      engagementPanelSectionListRenderer: {
        content: {
          sectionListRenderer: {
            contents: [{
              itemSectionRenderer: {
                contents: [
                  segment(2, "Intercepted panel text arrives from the network."),
                  segment(9, "Nothing here is scraped from the page."),
                ],
              },
            }],
          },
        },
      },
    },
  });
}

// A Short, with the description and transcript controls a watch page has, so a
// stray click from the extension would be counted.
const shortsFixture = `<!doctype html>
<html>
  <head><title>Fixture Short - YouTube</title></head>
  <body>
    <script>window.__clicks = 0;</script>
    <button id="expand" onclick="window.__clicks++">...more</button>
    <ytd-video-description-transcript-section-renderer>
      <button onclick="window.__clicks++">Show transcript</button>
    </ytd-video-description-transcript-section-renderer>
    <button aria-label="Transcript" onclick="window.__clicks++">T</button>
    <video></video>
  </body>
</html>`;

// A captioned watch page whose description lags an in-page navigation, as
// YouTube's does: right after the URL (and ytd-watch-flexy) switch to the next
// video, the description still holds the previous video's "Show transcript"
// button for about a second. Clicking it loads the PREVIOUS video's transcript.
// `window.__tldwNav(id)` performs that navigation; the next video has no
// captions, so once the description catches up it offers no transcript.
const staleDescriptionFixture = `<!doctype html>
<html>
  <head><title>Video A - YouTube</title></head>
  <body>
    <ytd-watch-flexy video-id="fixture-a"></ytd-watch-flexy>
    <ytd-watch-metadata video-id="fixture-a">
      <h1>Video A</h1>
      <div id="owner">
        <div id="channel-name"><a href="/@FixtureChannel">Fixture Channel</a></div>
        <div id="subscribe-button"></div>
      </div>
      <ytd-video-description-transcript-section-renderer>
        <button id="show-transcript">Show transcript</button>
      </ytd-video-description-transcript-section-renderer>
    </ytd-watch-metadata>
    <div id="below"></div>
    <div id="transcript-panel"></div>
    <script>
      window.__panelClicks = 0;
      document.getElementById("show-transcript").addEventListener("click", () => {
        window.__panelClicks++;
        // The button always belongs to video A: it loads A's transcript.
        fetch("/youtubei/v1/get_panel?prettyPrint=false", { method: "POST", body: "{}" }).then(() => {
          document.getElementById("transcript-panel").innerHTML = ${JSON.stringify(
            modernSegment("0:01", "1 second", "Video A's transcript must never reach video B."),
          )};
        });
      });
      window.__tldwNav = (id) => {
        history.pushState({}, "", "/watch?v=" + id);
        document.querySelector("ytd-watch-flexy").setAttribute("video-id", id);
        window.dispatchEvent(new Event("yt-navigate-finish"));
        setTimeout(() => {
          document.title = "Video B - YouTube";
          const md = document.querySelector("ytd-watch-metadata");
          md.setAttribute("video-id", id);
          md.querySelector("h1").textContent = "Video B";
          md.querySelector("ytd-video-description-transcript-section-renderer")?.remove();
        }, 1200);
      };
    </script>
  </body>
</html>`;

/**
 * A watch page with a stand-in for YouTube's player: #movie_player with the
 * player API's getPlayerResponse(), answering for the video in the URL.
 * `player` sets what it reports (null: no player API); `extra` is appended.
 */
function playerFixture(player: { lengthSeconds?: number; isLive?: boolean; captions?: boolean } | null, extra = ""): string {
  const api = player
    ? `<script>
        document.getElementById("movie_player").getPlayerResponse = () => ({
          videoDetails: {
            videoId: new URLSearchParams(location.search).get("v"),
            lengthSeconds: "${player.lengthSeconds ?? 600}",
            isLive: ${player.isLive ?? false},
          },
          ${player.captions ? 'captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ languageCode: "en" }] } },' : ""}
        });
      </script>`
    : "";
  return `<!doctype html>
<html>
  <head><title>Player Video - YouTube</title></head>
  <body>
    <div id="movie_player" class="html5-video-player"><div class="ytp-time-duration">10:00</div></div>
    ${api}
    <ytd-watch-metadata>
      <h1>Player Video</h1>
      <div id="owner">
        <div id="channel-name"><a href="/@FixtureChannel">Fixture Channel</a></div>
        <div id="subscribe-button"></div>
      </div>
    </ytd-watch-metadata>
    <div id="below"></div>
    ${extra}
  </body>
</html>`;
}

/**
 * A watch page with YouTube's engagement panels as rendered on 2026-11-02: the
 * old `engagement-panel-searchable-transcript` panel still exists but stays
 * hidden, and "Show transcript" expands a different panel, either
 * `PAmodern_transcript_view` or the "In this video" panel, which has no
 * target-id. The segments render only after the get_panel response arrives.
 * `openByUser` starts with that panel already open on the user's own choice,
 * showing the transcript or, for the "In this video" panel, its chapters.
 */
function modernPanelFixture(targetId: string | null, opts: { openByUser?: "transcript" | "chapters" } = {}): string {
  const target = targetId ? ` target-id="${targetId}"` : "";
  const visibility = opts.openByUser ? "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED" : "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN";
  return `<!doctype html>
<html>
  <head><title>Panel Video - YouTube</title></head>
  <body>
    <ytd-watch-metadata>
      <h1>Panel Video</h1>
      <div id="owner">
        <div id="channel-name"><a href="/@FixtureChannel">Fixture Channel</a></div>
        <div id="subscribe-button"></div>
      </div>
      <ytd-video-description-transcript-section-renderer>
        <button id="show-transcript">Show transcript</button>
      </ytd-video-description-transcript-section-renderer>
    </ytd-watch-metadata>
    <div id="below"></div>
    <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-searchable-transcript" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN">
      <div id="visibility-button"><button id="old-close" aria-label="Close transcript">x</button></div>
    </ytd-engagement-panel-section-list-renderer>
    <ytd-engagement-panel-section-list-renderer target-id="engagement-panel-comments-section" visibility="ENGAGEMENT_PANEL_VISIBILITY_HIDDEN">
      <div id="visibility-button"><button aria-label="Close">x</button></div>
    </ytd-engagement-panel-section-list-renderer>
    <ytd-engagement-panel-section-list-renderer id="modern-panel"${target} visibility="${visibility}">
      <div id="header"><div id="visibility-button"><button id="modern-close" aria-label="Close">x</button></div></div>
      <div id="content">${opts.openByUser === "transcript"
        ? modernSegment("0:02", "2 seconds", "The user opened this transcript themselves.")
        : opts.openByUser === "chapters" ? "<div>Chapter 1</div>" : ""}</div>
    </ytd-engagement-panel-section-list-renderer>
    <script>
      window.__oldCloseClicks = 0;
      window.__modernCloseClicks = 0;
      window.__showClicks = 0;
      const modern = document.getElementById("modern-panel");
      document.getElementById("old-close").addEventListener("click", () => { window.__oldCloseClicks++; });
      document.getElementById("modern-close").addEventListener("click", () => {
        window.__modernCloseClicks++;
        modern.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN");
      });
      document.getElementById("show-transcript").addEventListener("click", () => {
        window.__showClicks++;
        modern.setAttribute("visibility", "ENGAGEMENT_PANEL_VISIBILITY_EXPANDED");
        fetch("/youtubei/v1/get_panel?prettyPrint=false", { method: "POST", body: "{}" }).then(() => {
          setTimeout(() => {
            modern.querySelector("#content").innerHTML = ${JSON.stringify(
              modernSegment("0:02", "2 seconds", "Intercepted panel text arrives from the network."),
            )};
          }, 300);
        });
      });
    </script>
  </body>
</html>`;
}

// A Gemini web app stand-in whose composer keeps only the first 500
// characters of whatever is typed into it, like a site with a length limit.
// The composer mounts a moment after load, as the real app's does.
const truncatingGeminiFixture = `<!doctype html>
<html>
  <head><title>Gemini</title></head>
  <body>
    <script>
      setTimeout(() => {
        const editor = document.createElement("div");
        editor.className = "ql-editor";
        editor.contentEditable = "true";
        editor.style.cssText = "min-height:40px;border:1px solid #ccc";
        editor.addEventListener("input", () => {
          if (editor.textContent.length > 500) editor.textContent = editor.textContent.slice(0, 500);
        });
        document.body.appendChild(editor);
      }, 1500);
    </script>
  </body>
</html>`;

type ExtensionSession = {
  context: BrowserContext;
  extensionId: string;
  worker: import("@playwright/test").Worker;
  close: () => Promise<void>;
};

async function launchExtension(existingUserDataDir?: string): Promise<ExtensionSession> {
  const userDataDir = existingUserDataDir ?? fs.mkdtempSync(path.join(os.tmpdir(), "tldw-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      "--mute-audio",
    ],
  });
  let worker = context.serviceWorkers()[0];
  if (!worker) worker = await context.waitForEvent("serviceworker");
  await worker.evaluate(async () => {
    const deadline = Date.now() + 5_000;
    while (Date.now() < deadline) {
      const state = await chrome.storage.local.get(["profiles", "settings"]);
      if (state.profiles && state.settings) return;
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    throw new Error("Extension installation seeding did not finish");
  });
  const extensionId = new URL(worker.url()).host;
  return {
    context,
    extensionId,
    worker,
    close: async () => {
      await context.close();
      if (!existingUserDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });
    },
  };
}

async function setStorage(session: ExtensionSession, values: Record<string, unknown>): Promise<void> {
  await session.worker.evaluate(async (data) => {
    await chrome.storage.local.clear();
    await chrome.storage.local.set(data);
  }, values);
}

async function getStorage<T>(session: ExtensionSession, key: string): Promise<T | undefined> {
  return session.worker.evaluate(async (storageKey) => {
    const result = await chrome.storage.local.get(storageKey);
    return result[storageKey] as T | undefined;
  }, key);
}

async function routeYouTube(context: BrowserContext, body = youtubeFixture): Promise<void> {
  await context.route("https://www.youtube.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body });
  });
}

async function tabIdFor(session: ExtensionSession, url: string): Promise<number | undefined> {
  return session.worker.evaluate(async (pageUrl) => {
    const tabs = await chrome.tabs.query({});
    return tabs.find((tab) => tab.url === pageUrl)?.id;
  }, url);
}

function profiles() {
  const timestamp = "2026-07-20T00:00:00.000Z";
  return [
    {
      id: "global",
      name: "Global Profile",
      promptTemplate: "GLOBAL PROFILE {{url}}",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
    {
      id: "automatic",
      name: "Automatic Profile",
      promptTemplate: "AUTOMATIC PROFILE {{url}}",
      createdAt: timestamp,
      updatedAt: timestamp,
    },
  ];
}

function directSettings() {
  return {
    defaultProfileId: "global",
    directApiProfileId: "automatic",
    geminiApiKey: "fixture-key",
    geminiApiKeyName: "Fixture key",
    geminiKeyValidation: { status: "valid", verifiedAt: "2026-07-20T00:00:00.000Z" },
    useDirectApi: true,
    destinationId: "gemini",
  };
}

type GeminiCall = { model: string; prompt: string; videoUrl?: string; mediaResolution?: string };

async function mockGemini(
  context: BrowserContext,
  prompts: string[],
  status: number | ((model: string) => number) = 200,
  calls: GeminiCall[] = [],
): Promise<void> {
  await context.route("https://generativelanguage.googleapis.com/**", async (route) => {
    const model = new URL(route.request().url()).pathname.match(/models\/([^:/]+)/)?.[1] ?? "";
    const code = typeof status === "function" ? status(model) : status;
    if (route.request().method() === "GET") {
      await route.fulfill({ status: code, contentType: "application/json", body: code === 200 ? "{}" : '{"error":{"message":"rejected"}}' });
      return;
    }
    const body = route.request().postDataJSON() as {
      contents?: { parts?: { text?: string; fileData?: { fileUri?: string } }[] }[];
      generationConfig?: { mediaResolution?: string };
    };
    const parts = body.contents?.[0]?.parts ?? [];
    const prompt = parts.map((part) => part.text ?? "").join("");
    prompts.push(prompt);
    calls.push({
      model,
      prompt,
      videoUrl: parts.find((part) => part.fileData)?.fileData?.fileUri,
      mediaResolution: body.generationConfig?.mediaResolution,
    });
    if (code !== 200) {
      await route.fulfill({ status: code, contentType: "application/json", body: '{"error":{"message":"quota reached"}}' });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        candidates: [{
          content: {
            parts: [{ text: "---TLDW---\nSUMMARY: Fixture summary.\nDETAILS: Fixture details.\n---END TLDW---" }],
          },
        }],
      }),
    });
  });
}

async function openVideo(context: BrowserContext, id = "fixture-a"): Promise<Page> {
  const page = await context.newPage();
  await page.goto(`https://www.youtube.com/watch?v=${id}`);
  await expect(page.locator("#tldw-watch-btn")).toBeVisible();
  return page;
}

test("options and popup render from the production extension", async () => {
  const session = await launchExtension();
  try {
    const options = await session.context.newPage();
    await options.goto(`chrome-extension://${session.extensionId}/src/options/index.html`);
    await expect(options.getByRole("heading", { name: "Summarize any YouTube video." })).toBeVisible();

    const popup = await session.context.newPage();
    await popup.goto(`chrome-extension://${session.extensionId}/src/popup/index.html`);
    await expect(popup.locator("body")).toContainText("TL;DW");
  } finally {
    await session.close();
  }
});

test("saving a key verifies and persists valid metadata", async () => {
  const session = await launchExtension();
  try {
    await mockGemini(session.context, []);
    const options = await session.context.newPage();
    await options.goto(`chrome-extension://${session.extensionId}/src/options/index.html#directapi`);
    await options.getByPlaceholder("Name this key (e.g. Personal AI Studio key)").fill("E2E key");
    await options.getByPlaceholder(/Paste API key/).fill("fixture-key");
    await options.getByRole("button", { name: "Save key" }).click();
    await expect(options.getByText("Verified for Gemini 3.5 Flash-Lite.")).toBeVisible();
    const settings = await getStorage<{ geminiApiKey?: string; geminiKeyValidation?: { status?: string }; useDirectApi?: boolean }>(session, "settings");
    expect(settings?.geminiApiKey).toBe("fixture-key");
    expect(settings?.geminiKeyValidation?.status).toBe("valid");
    // A verified key turns Direct API mode on by itself.
    expect(settings?.useDirectApi).toBe(true);
    const usage = await getStorage<{ attemptsToday?: number }>(session, "geminiUsage");
    expect(usage?.attemptsToday).toBe(0);
  } finally {
    await session.close();
  }
});

test("invalid key verification remains saved with actionable status", async () => {
  const session = await launchExtension();
  try {
    await mockGemini(session.context, [], 403);
    const options = await session.context.newPage();
    await options.goto(`chrome-extension://${session.extensionId}/src/options/index.html#directapi`);
    await options.getByPlaceholder("Name this key (e.g. Personal AI Studio key)").fill("Restricted key");
    await options.getByPlaceholder(/Paste API key/).fill("restricted-key");
    await options.getByRole("button", { name: "Save key" }).click();
    await expect(options.getByText(/Google rejected this API key/)).toBeVisible();
    const settings = await getStorage<{ geminiApiKey?: string; geminiKeyValidation?: { status?: string }; useDirectApi?: boolean }>(session, "settings");
    expect(settings?.geminiApiKey).toBe("restricted-key");
    expect(settings?.geminiKeyValidation?.status).toBe("invalid");
    expect(settings?.useDirectApi).toBe(false);
  } finally {
    await session.close();
  }
});

test("manual and automatic summaries use their effective profiles", async () => {
  const manual = await launchExtension();
  try {
    const prompts: string[] = [];
    await routeYouTube(manual.context);
    await mockGemini(manual.context, prompts);
    await setStorage(manual, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(manual.context);
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("GLOBAL PROFILE");
    expect(prompts[0]).not.toContain("AUTOMATIC PROFILE");

    await page.reload();
    await expect(page.locator("#tldw-summary")).toContainText("💾 Cached (Global Profile)");
    expect(prompts).toHaveLength(1);
    const usage = await getStorage<{ attemptsToday?: number }>(manual, "geminiUsage");
    const stats = await getStorage<{ cacheHits?: number }>(manual, "tldwStats");
    expect(usage?.attemptsToday).toBe(1);
    expect(stats?.cacheHits).toBe(1);

    await page.bringToFront();
    const sourceTabId = await manual.worker.evaluate(async (url) => {
      const tabs = await chrome.tabs.query({});
      return tabs.find((tab) => tab.url === url)?.id;
    }, page.url());
    expect(sourceTabId).toBeDefined();
    const popupHarness = await manual.context.newPage();
    await popupHarness.goto(`chrome-extension://${manual.extensionId}/src/popup/index.html`);
    await popupHarness.evaluate(async (tabId) => {
      await chrome.runtime.sendMessage({
        type: "ASK",
        source: "popup-inline",
        sourceTabId: tabId,
        profileId: "automatic",
        userCuriosity: "What changed?",
      });
    }, sourceTabId);
    expect(prompts).toHaveLength(2);
    expect(prompts[1]).toContain("AUTOMATIC PROFILE");
    expect(prompts[1]).toContain("What changed?");

    await popupHarness.evaluate(async (tabId) => {
      await chrome.runtime.sendMessage({
        type: "ASK",
        source: "popup-inline",
        sourceTabId: tabId,
        profileId: "automatic",
        userCuriosity: "What changed?",
      });
    }, sourceTabId);
    expect(prompts).toHaveLength(2);
    const updatedStats = await getStorage<{ cacheHits?: number }>(manual, "tldwStats");
    expect(updatedStats?.cacheHits).toBe(2);
  } finally {
    await manual.close();
  }

  const automatic = await launchExtension();
  try {
    const prompts: string[] = [];
    await routeYouTube(automatic.context);
    await mockGemini(automatic.context, prompts);
    await setStorage(automatic, {
      profiles: profiles(),
      settings: directSettings(),
      autoRunChannels: [{
        id: "/@FixtureChannel",
        name: "Fixture Channel",
        avatarUrl: "",
        addedAt: "2026-07-20T00:00:00.000Z",
        autoRunSummary: true,
      }],
    });
    const page = await openVideo(automatic.context, "fixture-auto");
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("AUTOMATIC PROFILE");
  } finally {
    await automatic.close();
  }
});

test("SPA navigation drops a late summary for the previous video", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context);
    await session.context.route("https://generativelanguage.googleapis.com/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          candidates: [{ content: { parts: [{ text: "---TLDW---\nSUMMARY: Late A summary.\nDETAILS: Late details.\n---END TLDW---" }] } }],
        }),
      });
    });
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-a");
    await page.locator("#tldw-watch-btn").click();
    await page.evaluate(() => {
      history.pushState({}, "", "/watch?v=fixture-b");
      window.dispatchEvent(new Event("yt-navigate-finish"));
    });
    await page.waitForTimeout(800);
    await expect(page.locator("body")).not.toContainText("Late A summary.");
  } finally {
    await session.close();
  }
});

test("malformed model output ends loading with a retry", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context);
    await session.context.route("https://generativelanguage.googleapis.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ candidates: [{ content: { parts: [{ text: "not a TL;DW block" }] } }] }),
      });
    });
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-malformed");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("could not read");
    await expect(page.getByRole("button", { name: "↻ Try again" })).toBeVisible();
    await expect(page.locator("#tldw-watch-btn")).toHaveText("TL;DW");
  } finally {
    await session.close();
  }
});

test("a timed-out request ends loading with a retry", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context);
    await session.context.route("https://generativelanguage.googleapis.com/**", async (route) => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      await route.fulfill({ status: 200, contentType: "application/json", body: "{}" }).catch(() => {});
    });
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-timeout");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("Gemini took too long to answer");
    await expect(page.getByRole("button", { name: "↻ Try again" })).toBeVisible();
    await expect(page.locator("#tldw-watch-btn")).toHaveText("TL;DW");
  } finally {
    await session.close();
  }
});

test("browser and service-worker restart preserve settings and usage", async () => {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tldw-e2e-restart-"));
  const session = await launchExtension(userDataDir);
  try {
    await setStorage(session, {
      settings: directSettings(),
      geminiUsage: {
        version: 2,
        quotaDay: "2026-07-20",
        attemptsToday: 3,
        successesToday: 2,
        failuresToday: 1,
        attemptsSinceClear: 3,
        successesSinceClear: 2,
        failuresSinceClear: 1,
        allTimeAttempts: 9,
      },
    });
    await session.close();
    const restarted = await launchExtension(userDataDir);
    const persisted = await restarted.worker.evaluate(async () =>
      chrome.storage.local.get(["settings", "geminiUsage"]),
    );
    expect((persisted.settings as { geminiApiKeyName?: string }).geminiApiKeyName).toBe("Fixture key");
    expect((persisted.geminiUsage as { allTimeAttempts?: number }).allTimeAttempts).toBe(9);
    await restarted.close();
  } finally {
    await session.context.close().catch(() => {});
    fs.rmSync(userDataDir, { recursive: true, force: true });
  }
});

test("quota errors end loading and count a failed attempt", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context);
    await mockGemini(session.context, [], 429);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-quota");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("quota limit was reached");
    await expect(page.locator("#tldw-watch-btn")).toHaveText("TL;DW");
    const usage = await getStorage<{ attemptsToday?: number; failuresToday?: number }>(session, "geminiUsage");
    expect(usage?.attemptsToday).toBe(1);
    expect(usage?.failuresToday).toBe(1);
  } finally {
    await session.close();
  }
});

test("transcripts reach the prompt as spoken text only", async () => {
  const session = await launchExtension();
  try {
    const prompts: string[] = [];
    await routeYouTube(session.context);
    await mockGemini(session.context, prompts);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-clean");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");
    expect(prompts[0]).toContain(
      "The fixture transcript explains reliable extension testing. It recommends prompt-aware caching",
    );
    expect(prompts[0]).not.toMatch(/\d+ seconds?|0:0[15]/);
  } finally {
    await session.close();
  }
});

test("the transcript is read from YouTube's get_panel response", async () => {
  const session = await launchExtension();
  try {
    const prompts: string[] = [];
    await routeYouTube(session.context, getPanelFixture);
    await session.context.route("https://www.youtube.com/youtubei/v1/get_panel**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: getPanelBody("fixture-panel") });
    });
    await mockGemini(session.context, prompts);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-panel");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");
    expect(prompts[0]).toContain(
      "Intercepted panel text arrives from the network. Nothing here is scraped from the page.",
    );
  } finally {
    await session.close();
  }
});

test("the prompt names the video in the URL, not the title of the one before", async () => {
  const session = await launchExtension();
  try {
    const prompts: string[] = [];
    await routeYouTube(session.context);
    await mockGemini(session.context, prompts);
    const titled = profiles().map((p) => ({ ...p, promptTemplate: `${p.promptTemplate} TITLE={{title}}` }));
    await setStorage(session, { profiles: titled, settings: directSettings() });
    const page = await openVideo(session.context, "fixture-a");
    await page.evaluate(() => {
      document.title = "Video A - YouTube";
      const flexy = document.createElement("ytd-watch-flexy");
      flexy.setAttribute("video-id", "fixture-a");
      document.body.appendChild(flexy);
      const h1 = document.createElement("h1");
      h1.textContent = "Video A";
      document.querySelector("ytd-watch-metadata")!.prepend(h1);
    });
    // In-page navigation: the URL changes first; YouTube re-renders the title,
    // heading and video-id about a second later.
    await page.evaluate(() => {
      history.pushState({}, "", "/watch?v=fixture-b");
      setTimeout(() => {
        document.title = "Video B - YouTube";
        document.querySelector("ytd-watch-flexy")!.setAttribute("video-id", "fixture-b");
        document.querySelector("ytd-watch-metadata h1")!.textContent = "Video B";
      }, 1000);
    });
    const tabId = await tabIdFor(session, page.url());
    const popup = await session.context.newPage();
    await popup.goto(`chrome-extension://${session.extensionId}/src/popup/index.html`);
    await popup.evaluate(async (sourceTabId) => {
      await chrome.runtime.sendMessage({ type: "ASK", source: "popup-inline", sourceTabId });
    }, tabId);
    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("TITLE=Video B");
    expect(prompts[0]).not.toContain("Video A");
    const history = await getStorage<Array<{ videoTitle?: string; channel?: string }>>(session, "history");
    expect(history?.[0]?.videoTitle).toBe("Video B");
    // The empty avatar link ahead of the channel name must not blank the channel.
    expect(history?.[0]?.channel).toBe("Fixture Channel");
  } finally {
    await session.close();
  }
});

test("TL;DW does nothing on a YouTube Short", async () => {
  const session = await launchExtension();
  try {
    const prompts: string[] = [];
    await routeYouTube(session.context, shortsFixture);
    await mockGemini(session.context, prompts);
    await setStorage(session, { profiles: profiles(), settings: { ...directSettings(), useDirectApi: false } });
    const page = await session.context.newPage();
    await page.goto("https://www.youtube.com/shorts/fixture-short");
    await page.waitForTimeout(1500);
    await expect(page.locator("#tldw-watch-btn")).toHaveCount(0);

    // The transcript request answers at once and touches nothing on the page.
    const tabId = await tabIdFor(session, page.url());
    const started = Date.now();
    const transcript = await session.worker.evaluate(async (id) => {
      const res = await chrome.tabs.sendMessage(id!, { type: "GET_TRANSCRIPT" });
      return (res as { transcript: string | null }).transcript;
    }, tabId);
    expect(transcript).toBeNull();
    expect(Date.now() - started).toBeLessThan(1000);
    expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(0);

    // A send aimed at the Short (popup, keystroke or menu all take this path)
    // opens no destination tab and shows a quiet grey badge.
    const tabsBefore = session.context.pages().length;
    const popup = await session.context.newPage();
    await popup.goto(`chrome-extension://${session.extensionId}/src/popup/index.html`);
    await popup.evaluate(async (sourceTabId) => {
      await chrome.runtime.sendMessage({ type: "ASK", source: "command", sourceTabId });
    }, tabId);
    expect(await session.worker.evaluate(() => chrome.action.getBadgeText({}))).toBe("N/A");
    await page.waitForTimeout(500);
    expect(session.context.pages().length).toBe(tabsBefore + 1); // just the popup
    expect(prompts).toHaveLength(0);
    expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(0);
  } finally {
    await session.close();
  }
});

test("the popup says TL;DW isn't available on Shorts", async () => {
  const session = await launchExtension();
  try {
    // The popup reads the active tab; stand in a Short for it.
    await session.context.addInitScript(() => {
      if (location.protocol !== "chrome-extension:") return;
      const query = chrome.tabs.query.bind(chrome.tabs);
      chrome.tabs.query = (async (info: chrome.tabs.QueryInfo) => {
        if (info.active && info.currentWindow) {
          return [{ id: 999, url: "https://www.youtube.com/shorts/fixture-short", title: "Fixture Short - YouTube" }];
        }
        return query(info);
      }) as typeof chrome.tabs.query;
    });
    const popup = await session.context.newPage();
    await popup.goto(`chrome-extension://${session.extensionId}/src/popup/index.html`);
    await expect(popup.getByRole("status")).toHaveText("TL;DW isn't available on YouTube Shorts.");
    await expect(popup.locator(".ask-btn")).toHaveCount(0);
    await expect(popup.locator(".dest-grid")).toHaveCount(0);
  } finally {
    await session.close();
  }
});

/** Open the popup as if `tab` were the active tab. */
async function popupFor(session: ExtensionSession, tab: { id: number; url: string; title?: string }): Promise<Page> {
  const popup = await session.context.newPage();
  await popup.addInitScript((fake) => {
    const query = chrome.tabs.query.bind(chrome.tabs);
    chrome.tabs.query = (async (info: chrome.tabs.QueryInfo) =>
      info.active && info.currentWindow ? [fake] : query(info)) as typeof chrome.tabs.query;
    const w = window as unknown as { __created: string[] };
    w.__created = [];
    chrome.tabs.create = (async (props: chrome.tabs.CreateProperties) => {
      w.__created.push(props.url ?? "");
      return { id: -1 } as chrome.tabs.Tab;
    }) as typeof chrome.tabs.create;
    window.close = () => {};
  }, tab);
  await popup.goto(`chrome-extension://${session.extensionId}/src/popup/index.html`);
  return popup;
}

test("the popup says when a live stream can't be summarized yet", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context, playerFixture({ isLive: true, captions: false }));
    const page = await session.context.newPage();
    await page.goto("https://www.youtube.com/watch?v=fixture-live-popup");
    await expect.poll(() => page.evaluate(() => !!document.querySelector("ytd-watch-metadata h1"))).toBe(true);
    const tabId = await tabIdFor(session, page.url());
    const popup = await popupFor(session, { id: tabId!, url: page.url(), title: "Player Video - YouTube" });
    await expect(popup.getByRole("status")).toHaveText("This is a live stream. TL;DW can summarize it once the broadcast ends.");
    await expect(popup.locator(".ask-btn")).toHaveCount(0);
  } finally {
    await session.close();
  }
});

test("the popup's first-run tip offers a free key, and Recent opens the video instead of re-sending", async () => {
  const session = await launchExtension();
  try {
    await setStorage(session, {
      profiles: profiles(),
      settings: { defaultProfileId: "global" },
      history: [{
        id: "h1", videoUrl: "https://www.youtube.com/watch?v=recent-1", videoTitle: "A recent video",
        profileId: "global", profileName: "Global Profile", destinationId: "chatgpt", prompt: "x",
        createdAt: new Date().toISOString(),
      }],
    });
    const popup = await popupFor(session, { id: 1, url: "chrome://newtab/", title: "New Tab" });
    const tip = popup.getByRole("note");
    await expect(tip).toContainText("Works without a key: TL;DW opens Gemini in a tab.");
    await expect(tip.getByRole("button", { name: "Add a free Gemini key" })).toBeVisible();
    await popup.locator(".search-item", { hasText: "A recent video" }).click();
    expect(await popup.evaluate(() => (window as unknown as { __created: string[] }).__created))
      .toEqual(["https://www.youtube.com/watch?v=recent-1"]);
    expect(await session.worker.evaluate(async () => Object.keys((await chrome.storage.session.get("pendingPrompts")).pendingPrompts ?? {})))
      .toHaveLength(0);
    await tip.getByRole("button", { name: "Dismiss this tip" }).click();
    await expect(popup.getByRole("note")).toHaveCount(0);
    expect((await getStorage<{ firstRunNoticeSeen?: boolean }>(session, "settings"))?.firstRunNoticeSeen).toBe(true);
  } finally {
    await session.close();
  }
});

test("a first install opens the welcome page; a verified key turns Direct API on", async () => {
  const session = await launchExtension();
  try {
    await mockGemini(session.context, []);
    await expect.poll(() => session.context.pages().map((p) => p.url()).find((u) => u.endsWith("#welcome")))
      .toBe(`chrome-extension://${session.extensionId}/src/options/index.html#welcome`);
    const welcome = session.context.pages().find((p) => p.url().endsWith("#welcome"))!;
    await expect(welcome.getByRole("heading", { name: "Two ways it works" })).toBeVisible();
    await expect(welcome.getByRole("link", { name: "Google AI Studio ↗" })).toHaveAttribute("href", "https://aistudio.google.com/apikey");
    await welcome.getByRole("button", { name: "Skip, use without a key" }).click();
    await expect(welcome.getByRole("status")).toContainText("TL;DW will use Gemini in a tab");
    await welcome.getByRole("button", { name: "Add a key after all" }).click();
    await welcome.getByLabel("Gemini API key").fill("fixture-key");
    await welcome.getByRole("button", { name: "Save key" }).click();
    await expect(welcome.getByRole("status")).toContainText("You're set: Direct API is on.");
    expect((await getStorage<{ useDirectApi?: boolean }>(session, "settings"))?.useDirectApi).toBe(true);
  } finally {
    await session.close();
  }
});

async function transcriptFromPage(session: ExtensionSession, page: Page): Promise<{ transcript: string | null; ms: number }> {
  const tabId = await tabIdFor(session, page.url());
  const started = Date.now();
  const transcript = await session.worker.evaluate(async (id) => {
    const res = await chrome.tabs.sendMessage(id!, { type: "GET_TRANSCRIPT" });
    return (res as { transcript: string | null }).transcript;
  }, tabId);
  return { transcript, ms: Date.now() - started };
}

test("the previous video's transcript never reaches the next, uncaptioned video", async () => {
  const session = await launchExtension();
  try {
    const prompts: string[] = [];
    await routeYouTube(session.context, staleDescriptionFixture);
    await session.context.route("https://www.youtube.com/youtubei/v1/get_panel**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: getPanelBody("fixture-a") });
    });
    const calls: GeminiCall[] = [];
    await mockGemini(session.context, prompts, 200, calls);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-a");

    // In-page navigation to the uncaptioned video B, and an immediate send,
    // while the description still shows A's "Show transcript" button.
    await page.evaluate(() => (window as unknown as { __tldwNav: (id: string) => void }).__tldwNav("fixture-b"));
    await page.locator("#tldw-watch-btn").click();
    // While the send prepares, the toolbar badge shows progress.
    await expect.poll(() => session.worker.evaluate(() => chrome.action.getBadgeText({})), { timeout: 3_000, intervals: [50] }).toBe("…");
    // B has no transcript, so Gemini watches B from its link: A's transcript
    // is never sent, and the summary says how it was made.
    await expect(page.locator("#tldw-summary")).toContainText("Watched by Gemini (no transcript)");
    expect(calls).toHaveLength(1);
    expect(calls[0].videoUrl).toBe("https://www.youtube.com/watch?v=fixture-b");
    expect(calls[0].mediaResolution).toBe("MEDIA_RESOLUTION_LOW");
    expect(calls[0].prompt).not.toContain("Video A's transcript");
    // A's stale button was never clicked.
    expect(await page.evaluate(() => (window as unknown as { __panelClicks: number }).__panelClicks)).toBe(0);
    // Nothing built on A's transcript is cached under B.
    const cache = await getStorage<Record<string, unknown>>(session, "tldwSummaryCache");
    expect(JSON.stringify(cache ?? {})).not.toContain("Video A's transcript");
  } finally {
    await session.close();
  }
});

test("a video without a transcript answers at once instead of after a long wait", async () => {
  const session = await launchExtension();
  try {
    // The player reports no caption tracks: no transcript, no waiting.
    await routeYouTube(session.context, playerFixture({ captions: false }));
    const withPlayer = await openVideo(session.context, "fixture-uncaptioned");
    const fromPlayer = await transcriptFromPage(session, withPlayer);
    expect(fromPlayer.transcript).toBeNull();
    expect(fromPlayer.ms).toBeLessThan(1_000);
    await withPlayer.close();

    // Without the player's data, no "Show transcript" button for this video
    // means no transcript, after only a short grace for it to render.
    await session.context.unroute("https://www.youtube.com/**");
    await routeYouTube(session.context, playerFixture(null));
    const bare = await openVideo(session.context, "fixture-bare");
    const fromPage = await transcriptFromPage(session, bare);
    expect(fromPage.transcript).toBeNull();
    expect(fromPage.ms).toBeLessThan(2_500);
  } finally {
    await session.close();
  }
});

test("auto-run-if-long uses the video's length, not a pre-roll ad's", async () => {
  const session = await launchExtension();
  try {
    const prompts: string[] = [];
    await mockGemini(session.context, prompts);
    await setStorage(session, { profiles: profiles(), settings: { ...directSettings(), autoTldwMinutes: 30 } });

    // An hour-long video behind a 15-second ad, with no player data to read: the
    // player clock shows the ad's 0:15 until the ad ends.
    await routeYouTube(session.context, playerFixture(null, `<script>
      const player = document.getElementById("movie_player");
      player.classList.add("ad-showing");
      player.querySelector(".ytp-time-duration").textContent = "0:15";
      setTimeout(() => {
        player.classList.remove("ad-showing");
        player.querySelector(".ytp-time-duration").textContent = "1:00:00";
      }, 4000);
    </script>`));
    const page = await openVideo(session.context, "fixture-long-ad");
    // The run fires; the video has no transcript, so Gemini watches it.
    await expect(page.locator("#tldw-summary")).toContainText("Watched by Gemini (no transcript)", { timeout: 15_000 });
    expect(prompts).toHaveLength(1);
    await page.close();

    // With the player's data, the real length is known during the ad, and it is
    // what the worker records for the video.
    await session.context.unroute("https://www.youtube.com/**");
    await routeYouTube(session.context, playerFixture({ lengthSeconds: 3600, captions: false }, `<script>
      const player = document.getElementById("movie_player");
      player.classList.add("ad-showing");
      player.querySelector(".ytp-time-duration").textContent = "0:15";
    </script>`));
    const second = await openVideo(session.context, "fixture-long-ad-2");
    await expect(second.locator("#tldw-summary")).toContainText("Watched by Gemini (no transcript)", { timeout: 15_000 });
    const tabId = await tabIdFor(session, second.url());
    const meta = await session.worker.evaluate(async (id) => chrome.tabs.sendMessage(id!, { type: "GET_VIDEO_META" }), tabId);
    expect((meta as { durationSeconds: number }).durationSeconds).toBe(3600);
  } finally {
    await session.close();
  }
});

test("a live stream is recognized once its pre-roll ad ends, and is never sent", async () => {
  const session = await launchExtension();
  try {
    const prompts: string[] = [];
    await mockGemini(session.context, prompts);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    // During the ad nothing says "live"; the LIVE badge appears after it.
    await routeYouTube(session.context, playerFixture(null, `<script>
      const player = document.getElementById("movie_player");
      player.classList.add("ad-showing");
      setTimeout(() => {
        player.classList.remove("ad-showing");
        const badge = document.createElement("div");
        badge.className = "ytp-live-badge";
        badge.textContent = "LIVE";
        player.appendChild(badge);
      }, 2500);
    </script>`));
    const page = await openVideo(session.context, "fixture-live");
    await expect(page.locator("#tldw-watch-btn")).toHaveCount(0, { timeout: 5_000 });

    const tabId = await tabIdFor(session, page.url());
    const popup = await session.context.newPage();
    await popup.goto(`chrome-extension://${session.extensionId}/src/popup/index.html`);
    const reply = await popup.evaluate(async (sourceTabId) =>
      chrome.runtime.sendMessage({ type: "ASK", source: "popup-inline", sourceTabId }), tabId);
    expect(reply).toMatchObject({ ok: false });
    expect(await session.worker.evaluate(() => chrome.action.getBadgeText({}))).toBe("N/A");
    expect(prompts).toHaveLength(0);
  } finally {
    await session.close();
  }
});

// Where the destination tab is when TL;DW copies the prompt: in front, in the
// background (where Chrome refuses the async Clipboard API), or somewhere every
// way of copying fails.
for (const clipboard of ["front tab", "background tab", "blocked"] as const) {
  test(`a prompt the destination cuts short is reported and ends the page's run (${clipboard})`, async () => {
    const session = await launchExtension();
    try {
      await routeYouTube(session.context);
      await session.context.route("https://gemini.google.com/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "text/html", body: truncatingGeminiFixture });
      });
      await session.context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "https://gemini.google.com" });
      await setStorage(session, {
        profiles: profiles(),
        settings: { ...directSettings(), useDirectApi: false, temporaryChats: false, focusGeminiTab: false },
      });
      const page = await openVideo(session.context, "fixture-tab");
      // Context routes don't reach a tab the extension opens itself, so open it
      // blank and load the routed Gemini stand-in into it from here.
      await session.worker.evaluate(() => {
        const create = chrome.tabs.create.bind(chrome.tabs);
        chrome.tabs.create = ((props: chrome.tabs.CreateProperties) =>
          create({ ...props, url: "about:blank" })) as typeof chrome.tabs.create;
      });
      const geminiPage = session.context.waitForEvent("page");
      await page.locator("#tldw-watch-btn").click();
      const gemini = await geminiPage;
      // TL;DW's own script runs in an isolated world; find it to break copying.
      const cdp = await session.context.newCDPSession(gemini);
      const contexts: Array<{ id: number; origin: string; auxData?: { type?: string } }> = [];
      cdp.on("Runtime.executionContextCreated", ({ context }) => contexts.push(context));
      await cdp.send("Runtime.enable");
      // Playwright makes every page report focus; a background tab must not.
      if (clipboard !== "front tab") await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: false });
      await gemini.goto("https://gemini.google.com/app");
      if (clipboard === "front tab") await gemini.bringToFront();
      else await page.bringToFront();
      const isolatedWorld = async () => {
        await expect.poll(() => contexts.some(
          (c) => c.auxData?.type === "isolated" && c.origin === `chrome-extension://${session.extensionId}`,
        )).toBe(true);
        return contexts.filter(
          (c) => c.auxData?.type === "isolated" && c.origin === `chrome-extension://${session.extensionId}`,
        ).at(-1)!.id;
      };
      if (clipboard === "blocked") {
        await cdp.send("Runtime.evaluate", {
          contextId: await isolatedWorld(),
          expression: `
            window.__realWriteText = navigator.clipboard.writeText.bind(navigator.clipboard);
            window.__realExecCommand = document.execCommand.bind(document);
            Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: () => Promise.reject(new DOMException("blocked", "NotAllowedError")) });
            document.execCommand = (command, ...rest) => command === "copy" ? false : window.__realExecCommand(command, ...rest);
          `,
        });
      }
      const clipboardText = async () => {
        await cdp.send("Emulation.setFocusEmulationEnabled", { enabled: true });
        return gemini.evaluate(() => navigator.clipboard.readText());
      };

      // The site kept only the start: TL;DW says so and empties the composer so
      // the partial prompt can't be sent.
      await expect(gemini.locator("[data-tldw-toast]")).toContainText("Gemini cut the prompt off");
      await expect(gemini.locator(".ql-editor")).toHaveText("");
      // The YouTube page stops "Analyzing..." at once, with the reason and what
      // to do with the full prompt.
      await expect(page.locator("#tldw-summary")).toContainText("Gemini took only about", { timeout: 10_000 });
      await expect(page.locator("#tldw-watch-btn")).toHaveText("TL;DW");
      if (clipboard !== "blocked") {
        await expect(page.locator("#tldw-summary")).toContainText("The full prompt is on your clipboard: paste it into the Gemini tab.");
        expect(await clipboardText()).toContain("watch?v=fixture-tab");
      } else {
        await expect(page.locator("#tldw-summary")).not.toContainText("clipboard");
        await expect(page.locator("#tldw-summary")).toContainText('open the Gemini tab and click "Copy prompt"');
        expect(await clipboardText()).not.toContain("watch?v=fixture-tab");
        // The notice stays up with a button that copies the prompt on a click.
        await gemini.waitForTimeout(500);
        await cdp.send("Runtime.evaluate", {
          contextId: await isolatedWorld(),
          expression: `
            Object.defineProperty(navigator.clipboard, "writeText", { configurable: true, value: window.__realWriteText });
            document.execCommand = window.__realExecCommand;
          `,
        });
        await gemini.locator("[data-tldw-toast]").getByRole("button", { name: "Copy prompt" }).click();
        await expect(gemini.locator("[data-tldw-toast]")).toContainText("Copied");
        expect(await clipboardText()).toContain("watch?v=fixture-tab");
      }
      const status = await session.worker.evaluate(async () => (await chrome.storage.session.get(null)));
      expect(JSON.stringify(status)).toContain('"ok":false');
    } finally {
      await session.close();
    }
  });
}

test("a refused send ends the page's run with the reason", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context);
    await setStorage(session, { profiles: [], settings: directSettings() });
    const page = await openVideo(session.context, "fixture-no-profile");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("no prompt profile", { timeout: 5_000 });
    await expect(page.locator("#tldw-watch-btn")).toHaveText("TL;DW");
  } finally {
    await session.close();
  }
});

test("after the extension reloads, the old page UI is removed instead of hanging", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context);
    // A Gemini call that never answers keeps the run in flight.
    await session.context.route("https://generativelanguage.googleapis.com/**", () => {});
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-orphan");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-watch-btn")).toHaveText("Analyzing…");
    await session.worker.evaluate(() => chrome.runtime.reload()).catch(() => {});
    await expect(page.locator("#tldw-watch-btn")).toHaveCount(0, { timeout: 5_000 });
  } finally {
    await session.close();
  }
});

test("closing the auto-run confirmation leaves no key listener behind", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context);
    await mockGemini(session.context, []);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-confirm");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");

    // Listeners are listed per JavaScript world: read them from TL;DW's own
    // (isolated) world, where the content script adds them.
    const cdp = await session.context.newCDPSession(page);
    const contexts: Array<{ id: number; origin: string; auxData?: { type?: string } }> = [];
    cdp.on("Runtime.executionContextCreated", ({ context }) => contexts.push(context));
    await cdp.send("Runtime.enable");
    const isolated = contexts.find(
      (c) => c.auxData?.type === "isolated" && c.origin === `chrome-extension://${session.extensionId}`,
    );
    expect(isolated).toBeDefined();
    const keydownListeners = async () => {
      const { result } = await cdp.send("Runtime.evaluate", { expression: "document", contextId: isolated!.id });
      const { listeners } = await cdp.send("DOMDebugger.getEventListeners", { objectId: result.objectId! });
      return listeners.filter((l) => l.type === "keydown").length;
    };
    const before = await keydownListeners();
    for (const close of ["Cancel", "Escape", "backdrop"] as const) {
      await page.getByRole("button", { name: "↻ Auto-summarize" }).click();
      await expect(page.locator("#tldw-autorun-overlay")).toBeVisible();
      if (close === "Cancel") await page.getByRole("button", { name: "Cancel" }).click();
      else if (close === "Escape") await page.keyboard.press("Escape");
      else await page.locator("#tldw-autorun-overlay").click({ position: { x: 5, y: 5 } });
      await expect(page.locator("#tldw-autorun-overlay")).toHaveCount(0);
      expect(await keydownListeners(), `after closing with ${close}`).toBe(before);
    }
  } finally {
    await session.close();
  }
});

type PanelCounters = { __oldCloseClicks: number; __modernCloseClicks: number; __showClicks: number };
const panelState = (page: Page) => page.evaluate(() => ({
  visibility: document.getElementById("modern-panel")!.getAttribute("visibility"),
  ...(({ __oldCloseClicks, __modernCloseClicks, __showClicks }) => ({ __oldCloseClicks, __modernCloseClicks, __showClicks }))(
    window as unknown as PanelCounters,
  ),
}));

for (const targetId of ["PAmodern_transcript_view", null]) {
  test(`the transcript panel TL;DW opens is closed again (target-id ${targetId ?? "none"})`, async () => {
    const session = await launchExtension();
    try {
      const prompts: string[] = [];
      await routeYouTube(session.context, modernPanelFixture(targetId));
      await session.context.route("https://www.youtube.com/youtubei/v1/get_panel**", async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: getPanelBody("fixture-modern") });
      });
      await mockGemini(session.context, prompts);
      await setStorage(session, { profiles: profiles(), settings: directSettings() });
      const page = await openVideo(session.context, "fixture-modern");
      await page.locator("#tldw-watch-btn").click();
      await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");
      expect(prompts[0]).toContain("Intercepted panel text arrives from the network.");
      // The panel that opened is the one that gets closed; the hidden legacy
      // panel is never touched.
      await expect.poll(() => panelState(page)).toEqual({
        visibility: "ENGAGEMENT_PANEL_VISIBILITY_HIDDEN",
        __oldCloseClicks: 0,
        __modernCloseClicks: 1,
        __showClicks: 1,
      });
    } finally {
      await session.close();
    }
  });
}

for (const [targetId, openByUser] of [["PAmodern_transcript_view", "transcript"], [null, "chapters"]] as const) {
  test(`a panel the user opened stays open (${openByUser})`, async () => {
    const session = await launchExtension();
    try {
      await routeYouTube(session.context, modernPanelFixture(targetId, { openByUser }));
      await session.context.route("https://www.youtube.com/youtubei/v1/get_panel**", async (route) => {
        await route.fulfill({ status: 200, contentType: "application/json", body: getPanelBody("fixture-user-panel") });
      });
      await mockGemini(session.context, []);
      await setStorage(session, { profiles: profiles(), settings: directSettings() });
      const page = await openVideo(session.context, "fixture-user-panel");
      await page.locator("#tldw-watch-btn").click();
      await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");
      await page.waitForTimeout(2_500);
      const state = await panelState(page);
      expect(state.visibility).toBe("ENGAGEMENT_PANEL_VISIBILITY_EXPANDED");
      expect(state.__oldCloseClicks + state.__modernCloseClicks).toBe(0);
    } finally {
      await session.close();
    }
  });
}

test("a long video's automatic summary shows Analyzing and then the failure reason", async () => {
  const session = await launchExtension();
  try {
    const logs: string[] = [];
    await mockGemini(session.context, [], 429);
    await setStorage(session, { profiles: profiles(), settings: { ...directSettings(), autoTldwMinutes: 30 } });
    await routeYouTube(session.context, playerFixture(
      { lengthSeconds: 3600, captions: true },
      modernSegment("0:01", "1 second", "A long lecture begins."),
    ));
    // Record every label the TL;DW button shows, however briefly.
    await session.context.addInitScript(() => {
      const w = window as unknown as { __buttonLabels: string[] };
      w.__buttonLabels = [];
      new MutationObserver(() => {
        const label = document.getElementById("tldw-watch-btn")?.textContent ?? "";
        if (label && w.__buttonLabels.at(-1) !== label) w.__buttonLabels.push(label);
      }).observe(document, { subtree: true, childList: true, characterData: true });
    });
    const page = await session.context.newPage();
    page.on("console", (m) => logs.push(m.text()));
    await page.goto("https://www.youtube.com/watch?v=fixture-auto-long-fail");
    await expect(page.locator("#tldw-summary")).toContainText("quota limit was reached", { timeout: 10_000 });
    await expect(page.locator("#tldw-watch-btn")).toHaveText("TL;DW");
    expect(await page.evaluate(() => (window as unknown as { __buttonLabels: string[] }).__buttonLabels)).toContain("Analyzing…");
    // The console names the real reason, not a timeout.
    expect(logs.some((l) => l.includes("summary error panel shown") && l.includes("quota limit was reached"))).toBe(true);
    expect(logs.some((l) => l.includes("loading timed out"))).toBe(false);
  } finally {
    await session.close();
  }
});

test("a Direct API error keeps its AI Studio link even when the reply beats the error message", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context);
    await mockGemini(session.context, [], 429);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    // Deliver the worker's SET_SUMMARY_ERROR late, so the ASK reply lands first.
    await session.worker.evaluate(() => {
      const send = chrome.tabs.sendMessage.bind(chrome.tabs) as (...args: unknown[]) => Promise<unknown>;
      (chrome.tabs as unknown as { sendMessage: unknown }).sendMessage = (...args: unknown[]) => {
        const msg = args[1] as { type?: string };
        if (msg?.type === "SET_SUMMARY_ERROR") {
          return new Promise((resolve) => setTimeout(resolve, 500)).then(() => send(...args));
        }
        return send(...args);
      };
    });
    const page = await openVideo(session.context, "fixture-action-link");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("quota limit was reached");
    await expect(page.locator("#tldw-summary a", { hasText: "Open Google AI Studio" })).toBeVisible();
    await page.waitForTimeout(800);
    await expect(page.locator("#tldw-summary a", { hasText: "Open Google AI Studio" })).toBeVisible();
  } finally {
    await session.close();
  }
});

test("the live gate ignores the previous video's player and shows the button once it's known not live", async () => {
  const session = await launchExtension();
  try {
    await mockGemini(session.context, []);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    // Right after an in-page navigation the player still holds the previous
    // video, a live stream with its LIVE badge; 2 s later it loads this one.
    await routeYouTube(session.context, playerFixture(null, `<script>
      const player = document.getElementById("movie_player");
      const badge = document.createElement("div");
      badge.className = "ytp-live-badge";
      badge.textContent = "LIVE";
      player.appendChild(badge);
      let current = false;
      player.getPlayerResponse = () => ({
        videoDetails: current
          ? { videoId: new URLSearchParams(location.search).get("v"), lengthSeconds: "600", isLive: false }
          : { videoId: "fixture-previous-live", lengthSeconds: "0", isLive: true },
      });
      setTimeout(() => { current = true; badge.remove(); }, 2000);
    </script>`));
    const page = await session.context.newPage();
    await page.goto("https://www.youtube.com/watch?v=fixture-not-live");
    await page.waitForTimeout(1_800);
    await expect(page.locator("#tldw-watch-btn")).toBeVisible();
    await page.waitForTimeout(1_000);
    await expect(page.locator("#tldw-watch-btn")).toBeVisible();

    // Without player data, a LIVE badge left over from the previous video hides
    // the button only until a later check finds no badge.
    await session.context.unroute("https://www.youtube.com/**");
    await routeYouTube(session.context, playerFixture(null, `<script>
      const player = document.getElementById("movie_player");
      const badge = document.createElement("div");
      badge.className = "ytp-live-badge";
      badge.textContent = "LIVE";
      player.appendChild(badge);
      setTimeout(() => badge.remove(), 2500);
    </script>`));
    const second = await session.context.newPage();
    await second.goto("https://www.youtube.com/watch?v=fixture-not-live-2");
    await expect(second.locator("#tldw-watch-btn")).toBeVisible({ timeout: 6_000 });
  } finally {
    await session.close();
  }
});

// A watch page whose <video> has no media: the test drives currentTime and
// fires timeupdate itself. The player reports the video in `window.__playerVid`.
const sponsorFixture = `<!doctype html>
<html>
  <head><title>Sponsor Video - YouTube</title></head>
  <body>
    <div id="movie_player" class="html5-video-player"><video class="html5-main-video"></video></div>
    <script>
      window.__playerVid = new URLSearchParams(location.search).get("v");
      document.getElementById("movie_player").getPlayerResponse = () => ({
        videoDetails: { videoId: window.__playerVid, lengthSeconds: "600", isLive: false },
      });
      // Play from 5 s into 11 s, inside the 10-20 s sponsor; return where it ends up.
      window.__playInto = async () => {
        const v = document.querySelector("video");
        v.currentTime = 5; v.dispatchEvent(new Event("timeupdate"));
        await new Promise((r) => setTimeout(r, 50));
        v.currentTime = 11; v.dispatchEvent(new Event("timeupdate"));
        await new Promise((r) => setTimeout(r, 50));
        const t = v.currentTime;
        v.dispatchEvent(new Event("seeked"));
        return t;
      };
      window.__go = (path) => {
        history.pushState({}, "", path);
        window.dispatchEvent(new Event("yt-navigate-finish"));
      };
    </script>
  </body>
</html>`;

test("sponsor segments keep being skipped in the miniplayer, but not on Shorts or another video", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context, sponsorFixture);
    await session.context.route("https://sponsor.ajay.app/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ segment: [10, 20], category: "sponsor" }]) });
    });
    await setStorage(session, { profiles: profiles(), settings: { ...directSettings(), useDirectApi: false, skipSponsors: true } });
    const page = await session.context.newPage();
    await page.goto("https://www.youtube.com/watch?v=fixture-sponsor");
    const playInto = () => page.evaluate(() => (window as unknown as { __playInto: () => Promise<number> }).__playInto());
    const go = async (path: string) => {
      await page.evaluate((p) => (window as unknown as { __go: (p: string) => void }).__go(p), path);
      await page.waitForTimeout(1_200);
    };
    // On the watch page the sponsor is skipped.
    await expect.poll(playInto, { timeout: 10_000 }).toBe(20);

    // Browsing the home feed with the video in the miniplayer: still skipped.
    await go("/");
    expect(await playInto()).toBe(20);
    await go("/results?search_query=fixture");
    expect(await playInto()).toBe(20);

    // The miniplayer moves on to another video: its sponsor times don't apply.
    await page.evaluate(() => { (window as unknown as { __playerVid: string }).__playerVid = "fixture-other"; });
    await go("/feed/subscriptions");
    expect(await playInto()).toBe(11);
  } finally {
    await session.close();
  }
});

test("SponsorBlock is off until the user turns it on: no video ID is sent", async () => {
  const session = await launchExtension();
  try {
    const requests: string[] = [];
    await routeYouTube(session.context, sponsorFixture);
    await session.context.route("https://sponsor.ajay.app/**", async (route) => {
      requests.push(route.request().url());
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ segment: [10, 20], category: "sponsor" }]) });
    });
    // A fresh install's settings: SponsorBlock off.
    expect((await getStorage<{ skipSponsors?: boolean }>(session, "settings"))?.skipSponsors).toBe(false);
    const page = await session.context.newPage();
    await page.goto("https://www.youtube.com/watch?v=fixture-sponsor-off");
    const playInto = () => page.evaluate(() => (window as unknown as { __playInto: () => Promise<number> }).__playInto());
    await page.waitForTimeout(2_000);
    expect(await playInto()).toBe(11);
    expect(requests).toHaveLength(0);
  } finally {
    await session.close();
  }
});

test("sponsor segments are never applied on a Short", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context, sponsorFixture);
    await session.context.route("https://sponsor.ajay.app/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ segment: [10, 20], category: "sponsor" }]) });
    });
    await setStorage(session, { profiles: profiles(), settings: { ...directSettings(), useDirectApi: false, skipSponsors: true } });
    const page = await session.context.newPage();
    await page.goto("https://www.youtube.com/watch?v=fixture-sponsor-2");
    const playInto = () => page.evaluate(() => (window as unknown as { __playInto: () => Promise<number> }).__playInto());
    await expect.poll(playInto, { timeout: 10_000 }).toBe(20);
    await page.evaluate(() => (window as unknown as { __go: (p: string) => void }).__go("/shorts/fixture-short"));
    await page.waitForTimeout(1_200);
    expect(await playInto()).toBe(11);
  } finally {
    await session.close();
  }
});

// A watch page with YouTube's legacy transcript panel: "Show transcript" calls
// get_transcript, which YouTube answers for some captioned videos with
// 400 FAILED_PRECONDITION (seen 2026-11-02 on 3Blue1Brown videos), leaving its
// own panel empty.
const failingTranscriptFixture = playerFixture({ lengthSeconds: 1140, captions: true }, `
  <ytd-video-description-transcript-section-renderer>
    <button onclick="window.__clicks = (window.__clicks || 0) + 1; fetch('/youtubei/v1/get_transcript?prettyPrint=false', { method: 'POST', body: '{}' })">Show transcript</button>
  </ytd-video-description-transcript-section-renderer>`);

async function routeFailingTranscript(context: BrowserContext): Promise<void> {
  await context.route("https://www.youtube.com/youtubei/v1/get_transcript**", async (route) => {
    await route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ error: { code: 400, message: "Precondition check failed.", status: "FAILED_PRECONDITION" } }),
    });
  });
}

test("when YouTube fails to load a transcript, TL;DW stops waiting at once", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context, failingTranscriptFixture);
    await routeFailingTranscript(session.context);
    const page = await openVideo(session.context, "fixture-precondition");
    const { transcript, ms } = await transcriptFromPage(session, page);
    expect(transcript).toBeNull();
    expect(await page.evaluate(() => (window as unknown as { __clicks: number }).__clicks)).toBe(1);
    expect(ms).toBeLessThan(3_000);
  } finally {
    await session.close();
  }
});

/** YouTube's client config, which TL;DW's own transcript-panel request reads. */
const ytcfgScript = `<script>
  window.ytcfg = { get: (key) => ({
    INNERTUBE_CONTEXT: { client: { clientName: "WEB", clientVersion: "2.20261030.02.00" } },
    INNERTUBE_CONTEXT_CLIENT_NAME: 1,
    INNERTUBE_CLIENT_VERSION: "2.20261030.02.00",
    VISITOR_DATA: "fixture-visitor",
  })[key] };
</script>`;

test("a video whose Show transcript YouTube refuses is read from the transcript panel TL;DW asks for", async () => {
  // Seen 2026-11-02 on chaptered videos (3Blue1Brown) and, signed in, on a
  // 2.5-hour podcast: YouTube's button calls get_transcript, which answers 400
  // FAILED_PRECONDITION, while the modern get_panel still serves the transcript.
  const session = await launchExtension();
  try {
    const panelRequests: Array<{ body: Record<string, unknown>; credentials: string | null }> = [];
    await routeYouTube(session.context, failingTranscriptFixture.replace("<body>", `<body>${ytcfgScript}`));
    await routeFailingTranscript(session.context);
    await session.context.route("https://www.youtube.com/youtubei/v1/get_panel**", async (route) => {
      panelRequests.push({ body: route.request().postDataJSON() as Record<string, unknown>, credentials: await route.request().headerValue("cookie") });
      await route.fulfill({ status: 200, contentType: "application/json", body: getPanelBody("fixture-refused") });
    });
    const page = await openVideo(session.context, "fixture-refused");
    const { transcript } = await transcriptFromPage(session, page);
    expect(transcript).toBe("Intercepted panel text arrives from the network. Nothing here is scraped from the page.");
    // Asked for the right panel of the right video, without the user's cookies,
    // and without clicking anything on the page.
    expect(panelRequests).toHaveLength(1);
    expect(panelRequests[0].body).toMatchObject({ panelId: "PAmodern_transcript_view", params: "qgkTCg9maXh0dXJlLXJlZnVzZWQYAg==" });
    expect(panelRequests[0].credentials).toBeNull();
    expect(await page.evaluate(() => (window as unknown as { __clicks?: number }).__clicks ?? 0)).toBe(0);
  } finally {
    await session.close();
  }
});

test("no transcript with a key: Gemini watches the video, and a private one is refused clearly", async () => {
  const session = await launchExtension();
  try {
    const calls: GeminiCall[] = [];
    await routeYouTube(session.context, failingTranscriptFixture);
    await routeFailingTranscript(session.context);
    await mockGemini(session.context, [], 200, calls);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-no-transcript");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");
    await expect(page.locator("#tldw-summary [data-tldw-label]")).toHaveText("Watched by Gemini (no transcript)");
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      model: "gemini-3.5-flash-lite",
      videoUrl: "https://www.youtube.com/watch?v=fixture-no-transcript",
      mediaResolution: "MEDIA_RESOLUTION_LOW",
    });
    // The prompt never pretends to hold a transcript.
    expect(calls[0].prompt).not.toContain("TRANSCRIPT START");

    // Gemini refusing the video (private, age-restricted, removed) says so.
    await session.context.unroute("https://generativelanguage.googleapis.com/**");
    await mockGemini(session.context, [], 403, calls);
    await session.worker.evaluate(() => chrome.storage.local.remove("tldwSummaryCache"));
    await page.reload();
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("Gemini couldn't watch this video");
    await expect(page.locator("#tldw-summary")).toContainText("private, unlisted, age-restricted");
  } finally {
    await session.close();
  }
});

for (const destination of ["chatgpt", "chatgpt by shortcut"] as const) {
  test(`no transcript for a site that can't watch YouTube offers Gemini instead (${destination})`, async () => {
    const session = await launchExtension();
    try {
      const prompts: string[] = [];
      await routeYouTube(session.context, failingTranscriptFixture);
      await routeFailingTranscript(session.context);
      await mockGemini(session.context, prompts);
      const settings = { ...directSettings(), useDirectApi: false, destinationId: "chatgpt", focusGeminiTab: true };
      await setStorage(session, { profiles: profiles(), settings });
      const page = await openVideo(session.context, "fixture-no-transcript");
      const pagesBefore = session.context.pages().length;
      if (destination === "chatgpt by shortcut") {
        // What the keyboard shortcut sends, from an extension page.
        const tabId = await tabIdFor(session, page.url());
        const helper = await session.context.newPage();
        await helper.goto(`chrome-extension://${session.extensionId}/src/popup/index.html`);
        await helper.evaluate(async (sourceTabId) => {
          await chrome.runtime.sendMessage({ type: "ASK", source: "command", sourceTabId });
        }, tabId);
        await helper.close();
      } else {
        await page.locator("#tldw-watch-btn").click();
      }
      const panel = page.locator("#tldw-summary");
      await expect(panel).toContainText("ChatGPT can't watch YouTube videos");
      await expect(panel).not.toContainText("Couldn't get the summary");
      await expect(page.locator("#tldw-watch-btn")).toHaveText("TL;DW");
      expect(prompts).toHaveLength(0);
      expect(session.context.pages().length).toBe(pagesBefore);
      expect(await session.worker.evaluate(() => chrome.action.getBadgeText({}))).toBe("N/A");
      await expect(panel.getByRole("button", { name: "Add a free key" })).toBeVisible();

      // "Send the link to Gemini" opens Gemini in the background with the link
      // (no title-only prompt, no transcript), and the video keeps the focus.
      await session.worker.evaluate(() => {
        const create = chrome.tabs.create.bind(chrome.tabs);
        (globalThis as unknown as { __created: chrome.tabs.CreateProperties[] }).__created = [];
        chrome.tabs.create = ((props: chrome.tabs.CreateProperties) => {
          (globalThis as unknown as { __created: chrome.tabs.CreateProperties[] }).__created.push(props);
          return create({ ...props, url: "about:blank" });
        }) as typeof chrome.tabs.create;
      });
      await expect(panel).toContainText("Without an API key, Gemini can't watch it either");
      await panel.getByRole("button", { name: "Send the link to Gemini (public info only)" }).click();
      await expect.poll(() => session.worker.evaluate(() =>
        (globalThis as unknown as { __created: chrome.tabs.CreateProperties[] }).__created)).toHaveLength(1);
      const created = await session.worker.evaluate(() =>
        (globalThis as unknown as { __created: chrome.tabs.CreateProperties[] }).__created[0]);
      expect(created.url).toBe("https://gemini.google.com/app");
      expect(created.active).toBe(false);
      const pending = await session.worker.evaluate(async () => JSON.stringify(await chrome.storage.session.get("pendingPrompts")));
      expect(pending).toContain("watch?v=fixture-no-transcript");
      expect(pending).not.toContain("TRANSCRIPT START");
      await expect(panel).toContainText("Signed in, Gemini reads the captions through YouTube; signed out, it can only summarize public info about the video.");
    } finally {
      await session.close();
    }
  });
}

/** A watch page whose rendered transcript is about `chars` characters long. */
function longTranscriptFixture(chars: number): string {
  const line = "This lecture keeps going with careful detail about the topic at hand and more. ";
  const segments = Array.from({ length: Math.ceil(chars / line.length) }, (_, i) =>
    modernSegment(`${Math.floor(i / 60)}:${String(i % 60).padStart(2, "0")}`, `${i} seconds`, line + i)).join("");
  return youtubeFixture.replace(/<transcript-segment-view-model[\s\S]*<\/transcript-segment-view-model>/, segments);
}

/** Make chrome.tabs.create open about:blank and record what it was asked to open. */
async function recordTabCreates(session: ExtensionSession): Promise<() => Promise<chrome.tabs.CreateProperties[]>> {
  await session.worker.evaluate(() => {
    const create = chrome.tabs.create.bind(chrome.tabs);
    const g = globalThis as unknown as { __created: chrome.tabs.CreateProperties[] };
    g.__created = [];
    chrome.tabs.create = ((props: chrome.tabs.CreateProperties) => {
      g.__created.push(props);
      return create({ ...props, url: "about:blank" });
    }) as typeof chrome.tabs.create;
  });
  return () => session.worker.evaluate(() => (globalThis as unknown as { __created: chrome.tabs.CreateProperties[] }).__created);
}

async function pendingPrompt(session: ExtensionSession): Promise<string> {
  return session.worker.evaluate(async () => {
    const r = await chrome.storage.session.get("pendingPrompts");
    const all = Object.values((r.pendingPrompts ?? {}) as Record<string, { prompt: string }>);
    return all.at(-1)?.prompt ?? "";
  });
}

type ChatSite = "gemini" | "chatgpt" | "claude";

/**
 * The markup each chat site's stand-in uses: the composer around the editor,
 * the send button and the stop button that replaces it while the answer
 * streams, and the element the answer goes in.
 */
const CHAT_SITES: Record<ChatSite, {
  composer: [string, string];
  /** What wraps the page: the sidebar goes in the first slot, the chat in the second. */
  layout: [string, string, string];
  editor: string;
  send: string;
  stop: string;
  response: [string, string];
}> = {
  gemini: {
    composer: ["<input-container><input-area-v2><fieldset>", "</fieldset></input-area-v2></input-container>"],
    // Gemini's real nesting (2026-11-02): the whole app, composer included,
    // sits in side-navigation-v2, with the sidebar in bard-sidenav.
    layout: [
      "<side-navigation-v2><bard-sidenav-container><bard-sidenav>",
      "</bard-sidenav><bard-sidenav-content><chat-window>",
      "</chat-window></bard-sidenav-content></bard-sidenav-container></side-navigation-v2>",
    ],
    editor: '<div class="ql-editor" contenteditable="true" style="min-height:40px;border:1px solid #ccc"></div>',
    send: '<button class="send-button" aria-label="Send message">Send</button>',
    stop: '<button class="send-button stop" aria-label="Stop response">Stop</button>',
    response: ["<model-response><h2>Gemini said</h2><div class=\"markdown\">", "</div></model-response>"],
  },
  chatgpt: {
    composer: ["<form>", "</form>"],
    layout: ["<div>", "</div><main>", "</main>"],
    editor: '<div id="prompt-textarea" class="ProseMirror" contenteditable="true" style="min-height:40px;border:1px solid #ccc"></div>',
    send: '<button id="composer-submit-button" data-testid="send-button" aria-label="Send prompt" type="button">Send</button>',
    stop: '<button id="composer-submit-button" data-testid="stop-button" aria-label="Stop streaming" type="button">Stop</button>',
    response: ['<div data-message-author-role="assistant"><div class="markdown">', "</div></div>"],
  },
  claude: {
    composer: ["<fieldset>", "</fieldset>"],
    layout: ["<div>", "</div><main>", "</main>"],
    editor: '<div class="ProseMirror" contenteditable="true" style="min-height:40px;border:1px solid #ccc"></div>',
    send: '<button aria-label="Send message" type="button">Send</button>',
    stop: '<button aria-label="Stop response" type="button">Stop</button>',
    response: ['<div data-testid="assistant-message"><div>', "</div></div>"],
  },
};

/**
 * A signed-in sidebar of recent chats, each with a menu button named after its
 * chat, as Gemini, ChatGPT and Claude show it: titles with "Stop", "Cancel" or
 * "Send" in them once kept TL;DW waiting for a stop button that never left.
 */
const chatHistorySidebar = `<nav aria-label="Recent chats">
  ${["Cannot Stop Paused Timer", "Cancel my subscription", "Send email to Bob", "Stop generating ideas"]
    .map((title) => `<div><a href="#">${title}</a><button aria-label="More options for ${title}">⋮</button>` +
      `<button aria-label="${title}">${title}</button></div>`).join("\n  ")}
</nav>`;

/**
 * A chat-site stand-in that answers the way Gemini does in a background tab:
 * the whole answer is in the page, but its paragraphs stay `display: none`
 * ("p.pending") until the tab is shown, so the rendered text holds no answer
 * (seen live, 2026-11-02). Signed in, it shows Google's account button and a
 * chat-history sidebar; signed out, a "Sign in" link. While the answer
 * streams, the send button turns into a stop button, as on the real sites.
 */
function chatSiteFixture(
  site: ChatSite,
  signedIn: boolean,
  answer: { kind?: "tldw" | "raw"; delayMs?: number } = {},
): string {
  const m = CHAT_SITES[site];
  const account = signedIn
    ? '<a aria-label="Google Account: Fixture User" href="https://accounts.google.com/SignOutOptions">FU</a>'
    : '<a href="https://accounts.google.com/ServiceLogin?continue=https://gemini.google.com/app">Sign in</a>';
  return `<!doctype html>
<html>
  <head><title>Chat</title><style>.pending { display: none; }</style></head>
  <body>
    <header>${account}</header>
    ${m.layout[0]}${signedIn ? chatHistorySidebar : ""}${m.layout[1]}
      <div id="thread"></div>
      ${m.composer[0]}${m.editor}<span id="slot">${m.send}</span>${m.composer[1]}
    ${m.layout[2]}
    <script>
      const lines = ${answer.kind === "raw"
        ? JSON.stringify(["Here is a long answer that forgot the requested block entirely, so there is nothing to parse in it at all.",
          "It goes on for a while about the video without any of the field labels TL;DW asked for."])
        : JSON.stringify(["---TLDW---", "SUMMARY: Hidden answers are read in full.",
          "DETAILS: Background tabs keep finished paragraphs hidden until they are shown.", "---END TLDW---"])};
      const slot = document.getElementById("slot");
      const bind = () => slot.querySelector("button").addEventListener("click", () => {
        window.__sentPrompt = document.querySelector("[contenteditable]").textContent;
        slot.innerHTML = ${JSON.stringify(m.stop)};
        setTimeout(() => {
          document.getElementById("thread").insertAdjacentHTML("beforeend", ${JSON.stringify(m.response[0])} +
            lines.map((line) => '<p class="pending">' + line + "</p>").join("") + ${JSON.stringify(m.response[1])});
          window.__answeredAt = Date.now();
          slot.innerHTML = ${JSON.stringify(m.send)};
        }, ${answer.delayMs ?? 1200});
      });
      bind();
    </script>
  </body>
</html>`;
}

function hiddenAnswerGeminiFixture(signedIn: boolean): string {
  return chatSiteFixture("gemini", signedIn);
}

/** Profiles whose default template leaves out {{url}}, as TL;DW's own does. */
function profilesWithoutUrl() {
  return profiles().map((p) => (p.id === "global" ? { ...p, promptTemplate: "GLOBAL PROFILE {{title}}" } : p));
}

const PART_LABEL = "Summarized from part of the transcript (video is long). Add a free API key to summarize the whole video.";
const PUBLIC_INFO_LABEL =
  "No transcript, so Gemini summarized from public info about this video, not the video itself. Add a free API key so Gemini can watch it.";
const READ_TRANSCRIPT_LABEL = "Gemini read the video's transcript through YouTube";

const geminiTabCases = [
  { kind: "transcript", signedIn: false },
  { kind: "long video", signedIn: false },
  { kind: "long video", signedIn: true },
  { kind: "unread captions", signedIn: false },
  { kind: "unread captions", signedIn: true },
  { kind: "no captions", signedIn: true },
] as const;

for (const { kind, signedIn } of geminiTabCases) {
  test(`the Gemini tab's hidden answer comes back, labeled honestly (${kind}, ${signedIn ? "signed in" : "signed out"})`, async () => {
    const session = await launchExtension();
    try {
      if (kind === "unread captions") {
        await routeYouTube(session.context, failingTranscriptFixture);
        await routeFailingTranscript(session.context);
      } else if (kind === "no captions") {
        await routeYouTube(session.context, playerFixture({ lengthSeconds: 1140, captions: false }));
      } else {
        await routeYouTube(session.context, kind === "long video" ? longTranscriptFixture(40_000) : youtubeFixture);
      }
      await session.context.route("https://gemini.google.com/**", async (route) => {
        await route.fulfill({ status: 200, contentType: "text/html", body: hiddenAnswerGeminiFixture(signedIn) });
      });
      await setStorage(session, {
        profiles: profilesWithoutUrl(),
        settings: { ...directSettings(), geminiApiKey: "", useDirectApi: false, temporaryChats: false, focusGeminiTab: false },
      });
      const videoId = `fixture-hidden-${kind.replace(/ /g, "-")}-${signedIn ? "in" : "out"}`;
      const page = await openVideo(session.context, videoId);
      const created = await recordTabCreates(session);
      const geminiPage = session.context.waitForEvent("page");
      await page.locator("#tldw-watch-btn").click();
      const panel = page.locator("#tldw-summary");
      if (kind === "long video") {
        await expect(panel).toContainText(
          "This video is long. Signed in to Gemini, it reads the transcript through YouTube; signed out, it gets the transcript's start and end.",
        );
      } else if (kind === "unread captions") {
        await expect(panel).toContainText("Signed in, Gemini reads the captions through YouTube; signed out, it can only summarize public info");
      } else if (kind === "no captions") {
        await expect(panel).toContainText("so Gemini gets the link and can only summarize public info about the video");
      }
      await expect.poll(async () => (await created()).length).toBe(1);
      expect((await created())[0]).toMatchObject({ url: "https://gemini.google.com/app", active: false });

      // Context routes don't reach a tab the extension opens itself, so load the
      // routed stand-in into it from here; it stays behind the video.
      const gemini = await geminiPage;
      await gemini.goto("https://gemini.google.com/app");
      await page.bringToFront();
      await expect.poll(() => gemini.evaluate(() => (window as unknown as { __sentPrompt?: string }).__sentPrompt ?? "")).not.toBe("");
      const sent = await gemini.evaluate(() => (window as unknown as { __sentPrompt: string }).__sentPrompt);
      expect(await gemini.evaluate(() => document.querySelector("model-response")?.textContent ?? "")).toBe("");

      await expect(panel).toContainText("Hidden answers are read in full.", { timeout: 20_000 });
      await panel.getByRole("button", { name: "Show details ▾" }).click();
      await expect(panel).toContainText("Background tabs keep finished paragraphs hidden until they are shown.");
      await expect(panel).not.toContainText("---TLDW---");
      await expect(panel).not.toContainText("Watched");
      const label = panel.locator("[data-tldw-label]");
      const link = `Video link: https://www.youtube.com/watch?v=${videoId}`;
      const readTranscript = "Read this video's transcript (its captions) through YouTube";
      if (kind === "transcript") {
        await expect(label).toHaveCount(0);
        expect(sent).toContain("TRANSCRIPT START");
        expect(sent).not.toContain("transcript shortened");
      } else if (signedIn && kind !== "no captions") {
        // Signed in, Gemini reads the captions itself from the link.
        await expect(label).toHaveText(READ_TRANSCRIPT_LABEL);
        expect(sent).toContain(link);
        expect(sent).toContain(readTranscript);
        expect(sent).not.toContain("TRANSCRIPT START");
      } else if (kind === "long video") {
        await expect(label).toHaveText(PART_LABEL);
        await expect(label.getByRole("button", { name: "Add a free API key to summarize the whole video." })).toBeVisible();
        // As much of the real transcript as fits, its start and end kept.
        expect(sent.length).toBeLessThanOrEqual(30_000);
        expect(sent).toContain("TRANSCRIPT START");
        expect(sent).toContain("This lecture keeps going with careful detail about the topic at hand and more. 0");
        expect(sent).toMatch(/and more\. \d{3}<<<TRANSCRIPT END>>>/);
        expect(sent).toMatch(/\[\.\.\. transcript shortened: about \d+% of the transcript/);
      } else {
        // No transcript: the link, and only public info, signed in or not.
        await expect(label).toHaveText(PUBLIC_INFO_LABEL);
        expect(sent).toContain(link);
        expect(sent).not.toContain(readTranscript);
        expect(sent).not.toContain("TRANSCRIPT START");
      }
    } finally {
      await session.close();
    }
  });
}

for (const site of ["gemini", "chatgpt", "claude"] as const) {
  test(`a chat-history sidebar with "Stop" and "Cancel" in its chat titles doesn't hold the answer back (${site})`, async () => {
    const session = await launchExtension();
    try {
      await routeYouTube(session.context);
      const origin = { gemini: "https://gemini.google.com", chatgpt: "https://chatgpt.com", claude: "https://claude.ai" }[site];
      await session.context.route(`${origin}/**`, async (route) => {
        await route.fulfill({ status: 200, contentType: "text/html", body: chatSiteFixture(site, true) });
      });
      await setStorage(session, {
        profiles: profiles(),
        settings: {
          ...directSettings(), geminiApiKey: "", useDirectApi: false, temporaryChats: false, focusGeminiTab: false,
          destinationId: site,
        },
      });
      const page = await openVideo(session.context, `fixture-sidebar-${site}`);
      const created = await recordTabCreates(session);
      const chatPage = session.context.waitForEvent("page");
      await page.locator("#tldw-watch-btn").click();
      await expect.poll(async () => (await created()).length).toBe(1);
      const chat = await chatPage;
      await chat.goto((await created())[0].url!);
      await page.bringToFront();
      // TL;DW clicked the composer's send button, not a sidebar button.
      await expect.poll(() => chat.evaluate(() => (window as unknown as { __sentPrompt?: string }).__sentPrompt ?? "")).toContain("GLOBAL PROFILE");
      await expect.poll(() => chat.evaluate(() => (window as unknown as { __answeredAt?: number }).__answeredAt ?? 0)).toBeGreaterThan(0);
      // The summary arrives as soon as the composer's stop button is gone,
      // not after a safety wait or the three-minute deadline.
      await expect(page.locator("#tldw-summary")).toContainText("Hidden answers are read in full.", { timeout: 5_000 });
      await expect(page.locator("#tldw-summary")).not.toContainText("Couldn't get the summary");
    } finally {
      await session.close();
    }
  });
}

for (const kind of ["parsed", "unparsed", "late"] as const) {
  test(`only an answer the page was waiting for, parsed, is cached (${kind})`, async () => {
    test.setTimeout(60_000);
    const session = await launchExtension();
    try {
      await routeYouTube(session.context);
      await session.context.route("https://gemini.google.com/**", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          // The e2e build gives a page run 15 s; the late answer takes 20.
          body: chatSiteFixture("gemini", true, { kind: kind === "unparsed" ? "raw" : "tldw", delayMs: kind === "late" ? 20_000 : 1200 }),
        });
      });
      await setStorage(session, {
        profiles: profiles(),
        settings: { ...directSettings(), geminiApiKey: "", useDirectApi: false, temporaryChats: false, focusGeminiTab: false },
      });
      const videoId = `fixture-cache-${kind}`;
      const page = await openVideo(session.context, videoId);
      const created = await recordTabCreates(session);
      const chatPage = session.context.waitForEvent("page");
      await page.locator("#tldw-watch-btn").click();
      await expect.poll(async () => (await created()).length).toBe(1);
      const chat = await chatPage;
      await chat.goto("https://gemini.google.com/app");
      await page.bringToFront();
      const panel = page.locator("#tldw-summary");
      if (kind === "late") await expect(panel).toContainText("Couldn't get the summary back in time", { timeout: 20_000 });
      // The page still shows the answer it gets.
      await expect(panel).toContainText(
        kind === "unparsed" ? "Here is a long answer that forgot the requested block" : "Hidden answers are read in full.",
        { timeout: 25_000 },
      );
      const cached = async () => JSON.stringify((await getStorage<Record<string, unknown>>(session, "tldwSummaryCache")) ?? {});
      if (kind === "parsed") {
        await expect.poll(cached).toContain(videoId);
      } else {
        await page.waitForTimeout(1500);
        expect(await cached()).not.toContain(videoId);
      }
    } finally {
      await session.close();
    }
  });
}

test("a transcript too long for ChatGPT asks first, and sends part of it, labeled, when chosen", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context, longTranscriptFixture(70_000));
    await setStorage(session, {
      profiles: profiles(),
      settings: { ...directSettings(), geminiApiKey: "", useDirectApi: false, destinationId: "chatgpt", temporaryChats: false },
    });
    const page = await openVideo(session.context, "fixture-long-chatgpt");
    const created = await recordTabCreates(session);
    await page.locator("#tldw-watch-btn").click();
    const panel = page.locator("#tldw-summary");
    await expect(panel).toContainText("too long for ChatGPT's message box");
    await expect(panel.getByRole("button", { name: "Add a free key" })).toBeVisible();
    // Gemini's message box is smaller than ChatGPT's, so it isn't offered here.
    await expect(panel.getByRole("button", { name: /Gemini/ })).toHaveCount(0);
    expect(await created()).toHaveLength(0);
    await panel.getByRole("button", { name: "Send part of the transcript" }).click();
    await expect.poll(async () => (await created()).length).toBe(1);
    expect((await created())[0]).toMatchObject({ url: "https://chatgpt.com/", active: false });
    const prompt = await pendingPrompt(session);
    expect(prompt).toContain("its middle is left out where marked");
    expect(prompt.length).toBeLessThanOrEqual(50_000);
    await expect(panel).toContainText("This video is long, so ChatGPT gets part of the transcript (its start and end).");
  } finally {
    await session.close();
  }
});

test("with a key, a long transcript goes to the API whole", async () => {
  const session = await launchExtension();
  try {
    const calls: GeminiCall[] = [];
    await routeYouTube(session.context, longTranscriptFixture(120_000));
    await mockGemini(session.context, [], 200, calls);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-long-api");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");
    expect(calls).toHaveLength(1);
    expect(calls[0].videoUrl).toBeUndefined();
    expect(calls[0].prompt.length).toBeGreaterThan(120_000);
    expect(calls[0].prompt).not.toContain("transcript truncated");
  } finally {
    await session.close();
  }
});

test("a rate-limited default model falls back to 3.1 Flash-Lite and says so once", async () => {
  const session = await launchExtension();
  try {
    const calls: GeminiCall[] = [];
    await routeYouTube(session.context);
    await mockGemini(session.context, [], (model) => (model === "gemini-3.5-flash-lite" ? 429 : 200), calls);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-fallback");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");
    await expect(page.locator("#tldw-summary [data-tldw-note]")).toHaveText(
      "Gemini 3.5 Flash-Lite hit its rate or quota limit, so TL;DW used Gemini 3.1 Flash-Lite for this summary.",
    );
    expect(calls.map((c) => c.model)).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
    await expect(page.locator("#tldw-summary")).toContainText("⚡ Gemini 3.1 Flash-Lite");

    // The next summary falls back again but doesn't repeat the notice.
    const second = await openVideo(session.context, "fixture-fallback-2");
    await second.locator("#tldw-watch-btn").click();
    await expect(second.locator("#tldw-summary")).toContainText("Fixture summary.");
    await expect(second.locator("#tldw-summary [data-tldw-note]")).toHaveCount(0);
  } finally {
    await session.close();
  }
});

test("API errors offer the action that fixes them", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context);
    await mockGemini(session.context, [], 401);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-bad-key");
    await page.locator("#tldw-watch-btn").click();
    const panel = page.locator("#tldw-summary");
    await expect(panel.getByRole("button", { name: "Replace key in TL;DW settings" })).toBeVisible();
    await panel.getByRole("button", { name: "Replace key in TL;DW settings" }).click();
    // It reuses the options tab already open (the welcome page) or opens one.
    await expect.poll(() => session.context.pages().some((p) => p.url().endsWith("options/index.html#directapi")))
      .toBe(true);

    // Both Flash-Lite models rate limited: offer the Gemini tab instead.
    await session.context.unroute("https://generativelanguage.googleapis.com/**");
    const calls: GeminiCall[] = [];
    await mockGemini(session.context, [], 429, calls);
    const limited = await openVideo(session.context, "fixture-limited");
    await limited.locator("#tldw-watch-btn").click();
    await expect(limited.locator("#tldw-summary").getByRole("button", { name: "Send to Gemini in a tab instead" })).toBeVisible();
    expect(calls.map((c) => c.model)).toEqual(["gemini-3.5-flash-lite", "gemini-3.1-flash-lite"]);
  } finally {
    await session.close();
  }
});

test("the model picker changes the model TL;DW calls", async () => {
  const session = await launchExtension();
  try {
    const calls: GeminiCall[] = [];
    await routeYouTube(session.context);
    await mockGemini(session.context, [], 200, calls);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const options = await session.context.newPage();
    await options.goto(`chrome-extension://${session.extensionId}/src/options/index.html#directapi`);
    await options.getByRole("tab", { name: "Behavior" }).click();
    await options.getByRole("radio", { name: /Gemini 3\.6 Flash/ }).check();
    await expect.poll(async () => (await getStorage<{ geminiModelId?: string }>(session, "settings"))?.geminiModelId)
      .toBe("gemini-3.6-flash");
    const page = await openVideo(session.context, "fixture-model");
    await page.locator("#tldw-watch-btn").click();
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");
    expect(calls.at(-1)?.model).toBe("gemini-3.6-flash");
  } finally {
    await session.close();
  }
});


test("details show as a list behind a real button, and the panel fits a narrow window", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context);
    await session.context.route("https://generativelanguage.googleapis.com/**", async (route) => {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ candidates: [{ content: { parts: [{
          text: "---TLDW---\nSUMMARY: Three habits matter.\nDETAILS: They are:\n- Sleep **eight** hours.\n- Walk daily.\n- Eat protein.\n---END TLDW---",
        }] } }] }),
      });
    });
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-list");
    await page.locator("#tldw-watch-btn").click();
    const toggle = page.getByRole("button", { name: "Show details ▾" });
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#tldw-summary li")).toHaveCount(3);
    await expect(page.locator("#tldw-summary li").first()).toBeHidden();
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Hide details ▴" })).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#tldw-summary li")).toHaveText(["Sleep eight hours.", "Walk daily.", "Eat protein."]);
    await page.keyboard.press("Space");
    await expect(page.locator("#tldw-summary li").first()).toBeHidden();

    // A column wider than the window (as YouTube's is at 420px) doesn't clip the panel.
    await page.evaluate(() => { const below = document.getElementById("below")!; below.style.marginLeft = "-6px"; below.style.width = "calc(100% + 30px)"; });
    await page.setViewportSize({ width: 420, height: 800 });
    await expect.poll(() => page.evaluate(() => {
      const r = document.getElementById("tldw-summary")!.getBoundingClientRect();
      return r.left >= 0 && r.right <= document.documentElement.clientWidth;
    })).toBe(true);
  } finally {
    await session.close();
  }
});
