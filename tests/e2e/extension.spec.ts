import { expect, test, type BrowserContext, type Page, chromium } from "@playwright/test";
import fs from "fs";
import os from "os";
import path from "path";

const extensionPath = path.resolve("dist");
const youtubeFixture = `<!doctype html>
<html>
  <head><title>Fixture Video - YouTube</title></head>
  <body>
    <ytd-watch-metadata>
      <div id="owner">
        <div id="channel-name"><a href="/@FixtureChannel">Fixture Channel</a></div>
        <div id="subscribe-button"></div>
      </div>
    </ytd-watch-metadata>
    <div id="below"></div>
    <transcript-segment-view-model>00:01 The fixture transcript explains reliable extension testing.</transcript-segment-view-model>
    <transcript-segment-view-model>00:05 It recommends prompt-aware caching and correct profile selection.</transcript-segment-view-model>
  </body>
</html>`;

type ExtensionSession = {
  context: BrowserContext;
  extensionId: string;
  worker: import("@playwright/test").Worker;
  close: () => Promise<void>;
};

async function launchExtension(): Promise<ExtensionSession> {
  const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tldw-e2e-"));
  const context = await chromium.launchPersistentContext(userDataDir, {
    channel: "chromium",
    headless: true,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
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
      fs.rmSync(userDataDir, { recursive: true, force: true });
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

async function routeYouTube(context: BrowserContext): Promise<void> {
  await context.route("https://www.youtube.com/**", async (route) => {
    await route.fulfill({ status: 200, contentType: "text/html", body: youtubeFixture });
  });
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
    await expect(page.locator("#tldw-summary")).toContainText("cached · Global Profile");
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
