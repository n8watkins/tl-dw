# TL;DW

TL;DW means "Too Long; Didn't Watch." It is a Manifest V3 Chrome extension that
summarizes the YouTube video you're watching so you can decide whether it's worth
your time before you spend it.

## What It Does

- Detects YouTube watch pages and Shorts automatically.
- Builds an analysis prompt from an editable prompt profile (TL;DW, Research,
  Learning, Tutorial — or your own).
- Summarizes a video two ways:
  - **Direct API (recommended)** — calls Google's Gemini API directly with your
    own free key. The verdict and summary appear **right on the YouTube page** in
    an injected widget; no tab ever opens. The free tier covers ~500 videos/day.
  - **Open in a tab** — opens your chosen AI (Gemini, ChatGPT, Claude, or
    NotebookLM) with the prompt already filled and submitted. TL;DW
    reads the finished answer back out of the tab and drops the summary onto the
    YouTube page. Falls back to copying the prompt if the composer can't be filled.
- For AIs that can't watch a video, TL;DW extracts the full transcript (from
  YouTube's own intercepted caption data) and attaches it.
- **Auto-summarize** videos over a configurable length, and an optional upfront
  WATCH / SKIM / SKIP verdict gate for long videos.
- **Engagement tracking** — measures how much of each video you actually watch and
  auto-rates it Engaged / Skimmed / Skipped, building per-channel insights.
- **SponsorBlock auto-skip** — skips in-video sponsored segments using the free
  community SponsorBlock data.
- **Stats dashboard** — lifetime summaries, watch time, sponsor time saved, and an
  activity heatmap.
- An options page for setup, profiles, history, channels, stats, and settings.

## Privacy

- No backend service, no analytics, no accounts.
- Everything is stored in Chrome's local storage on your machine.
- History saves a transcript-free prompt + video metadata — never the full
  transcript.
- **Direct API mode** uses a Gemini API key you supply; it is stored locally and
  used only to call Google's API. By default the call log keeps metadata only (no
  prompt/response text); turn on "keep full call log" if you want prompts and
  responses retained for debugging.
- **Open-in-a-tab mode** uses whatever AI account you're already signed into; the
  prompt and transcript are sent to that site like any chat message.

## Local Setup

Install dependencies:

```bash
npm install
```

Run a local Vite dev server (live iteration, no version bump):

```bash
npm run dev
```

Typecheck and run the unit tests:

```bash
npm run typecheck
npm test
```

Build and copy to the Windows folder Chrome loads from:

```bash
npm run build
```

`npm run build` increments the patch version in `package.json` and
`package-lock.json`, builds `dist/`, and copies the built extension to:

```text
/mnt/c/Users/natha/Projects/Tools/tldw
```

The version bumps on every build so the number in the popup always changes — a
quick way to confirm a reload actually picked up the new build. If the build or
Windows copy step fails, the package version files are restored to their previous
contents.

After a successful build, open `chrome://extensions` and click Reload on the
unpacked TL;DW extension so Chrome picks up the copied files. The popup's version
number should match the latest build.

## Chrome Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `C:\Users\natha\Projects\Tools\tldw`.
5. Confirm or adjust the shortcut at `chrome://extensions/shortcuts`
   (default `Alt+Shift+G`).

## Contributing

The forward-looking feature backlog lives in [`FEATURES.md`](FEATURES.md) (the
live status doc remains [`STATUS.md`](STATUS.md)). Larger feature work is split
across two parallel streams using git worktrees with disjoint file ownership so
they never conflict:

- [`agents/PHASE_0.md`](agents/PHASE_0.md) — shared types/keys to land on `master`
  first, before the streams branch off.
- [`agents/AGENT_A.md`](agents/AGENT_A.md) — data/prompt layer (storage,
  prompt builder, profiles, background, options sections).
- [`agents/AGENT_B.md`](agents/AGENT_B.md) — widget UI in `src/content/youtube.ts`.

Whatever you touch, gate every change with `npm run typecheck` and `npm test`
(currently 79 passing unit tests) before committing.
