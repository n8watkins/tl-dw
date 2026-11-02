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

async function mockGemini(
  context: BrowserContext,
  prompts: string[],
  status = 200,
): Promise<void> {
  await context.route("https://generativelanguage.googleapis.com/**", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ status, contentType: "application/json", body: status === 200 ? "{}" : '{"error":{"message":"rejected"}}' });
      return;
    }
    const body = route.request().postDataJSON() as { contents?: { parts?: { text?: string }[] }[] };
    prompts.push(body.contents?.[0]?.parts?.[0]?.text ?? "");
    if (status !== 200) {
      await route.fulfill({ status, contentType: "application/json", body: '{"error":{"message":"quota reached"}}' });
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
    await expect(options.getByText("Verified for Gemini 3.1 Flash-Lite.")).toBeVisible();
    const settings = await getStorage<{ geminiApiKey?: string; geminiKeyValidation?: { status?: string } }>(session, "settings");
    expect(settings?.geminiApiKey).toBe("fixture-key");
    expect(settings?.geminiKeyValidation?.status).toBe("valid");
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
    const settings = await getStorage<{ geminiApiKey?: string; geminiKeyValidation?: { status?: string } }>(session, "settings");
    expect(settings?.geminiApiKey).toBe("restricted-key");
    expect(settings?.geminiKeyValidation?.status).toBe("invalid");
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
    await expect(page.locator("#tldw-summary")).toContainText("60-second timeout");
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
    await mockGemini(session.context, prompts);
    await setStorage(session, { profiles: profiles(), settings: directSettings() });
    const page = await openVideo(session.context, "fixture-a");

    // In-page navigation to the uncaptioned video B, and an immediate send,
    // while the description still shows A's "Show transcript" button.
    await page.evaluate(() => (window as unknown as { __tldwNav: (id: string) => void }).__tldwNav("fixture-b"));
    await page.locator("#tldw-watch-btn").click();
    // While the send prepares, the toolbar badge shows progress.
    await expect.poll(() => session.worker.evaluate(() => chrome.action.getBadgeText({})), { timeout: 3_000, intervals: [50] }).toBe("…");
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.");

    expect(prompts).toHaveLength(1);
    expect(prompts[0]).toContain("watch?v=fixture-b");
    expect(prompts[0]).not.toContain("Video A's transcript");
    expect(prompts[0]).not.toContain("<<<TRANSCRIPT START>>>");
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
    await expect(page.locator("#tldw-summary")).toContainText("Fixture summary.", { timeout: 15_000 });
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
    await expect(second.locator("#tldw-summary")).toContainText("Fixture summary.", { timeout: 15_000 });
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
    await routeYouTube(session.context, playerFixture({ lengthSeconds: 3600, captions: false }));
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
    await setStorage(session, { profiles: profiles(), settings: { ...directSettings(), useDirectApi: false } });
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

test("sponsor segments are never applied on a Short", async () => {
  const session = await launchExtension();
  try {
    await routeYouTube(session.context, sponsorFixture);
    await session.context.route("https://sponsor.ajay.app/**", async (route) => {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify([{ segment: [10, 20], category: "sponsor" }]) });
    });
    await setStorage(session, { profiles: profiles(), settings: { ...directSettings(), useDirectApi: false } });
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
