# TL;DW

TL;DW means "Too Long; Didn't Watch." It is a Manifest V3 Chrome extension that
summarizes the YouTube video you're watching — pulling the transcript and getting
you an AI summary — so you can get the gist without watching the whole thing. It's
an un-opinionated summarizer: it gives you a SUMMARY and the DETAILS, shaped by
your own prompt profiles and tags. It doesn't tell you whether to watch (you can
ask for that in your own prompt).

## What It Does

- Detects YouTube watch pages and Shorts automatically.
- Builds a summary prompt from an editable prompt profile (TL;DW, Research,
  Learning, Tutorial — or your own), tweaked by reusable tags you assign to a
  channel or video.
- Summarizes a video two ways:
  - **Direct API (recommended)** — calls Google's Gemini API directly with your
    own free key. The summary appears **right on the YouTube page** in an injected
    widget; no tab ever opens. The free tier covers ~500 videos/day.
  - **Open in a tab** — opens your chosen AI (Gemini, ChatGPT, Claude, or
    NotebookLM) with the prompt already filled and submitted. TL;DW
    reads the finished answer back out of the tab and drops the summary onto the
    YouTube page. Falls back to copying the prompt if the composer can't be filled.
- For AIs that can't watch a video, TL;DW extracts the full transcript (from
  YouTube's own intercepted caption data) and attaches it.
- **Auto-summarize** videos over a configurable length.
- **SponsorBlock auto-skip** — skips in-video sponsored segments using the free
  community SponsorBlock data.
- **Summary-activity stats** — lifetime summaries, channels you summarize most,
  prompt-profile and destination usage, most-used tags, and a GitHub-style
  summary-activity heatmap with a day streak.
- An options page for setup, profiles, tags, history, channels, stats, and
  settings.

## Privacy

- No backend service, no analytics, no accounts.
- Everything is stored in Chrome's local storage on your machine.
- No watch-time or engagement tracking. Stats are summary-centric only.
- History saves a transcript-free prompt + video metadata — never the full
  transcript.
- **Direct API mode** uses a Gemini API key you supply; it is stored locally and
  used only to call Google's API. By default the call log keeps metadata only (no
  prompt/response text); turn on "keep full call log" if you want prompts and
  responses retained for debugging.
- **Open-in-a-tab mode** uses whatever AI account you're already signed into; the
  prompt and transcript are sent to that site like any chat message.

See [`PRIVACY.md`](PRIVACY.md) for the full privacy policy.

## Local Setup

Requires Node 18+ (the Vite toolchain and the ESM `.mjs` build scripts assume a
modern Node).

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
quick way to confirm a reload actually picked up the new build. If the build fails
before `vite build` finishes, the version bump is rolled back; if the build
succeeds but the Windows copy step fails, the bumped version is kept so
`package.json` stays in sync with `dist/`.

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

## Documentation

- [`STATUS.md`](STATUS.md) — the live status: what's built, known bugs,
  architecture map, and next steps.
- [`PLAN.md`](PLAN.md) — the product thesis and how the core inject-and-submit
  motion works.
- [`LESSONS_LEARNED.md`](LESSONS_LEARNED.md) — hard-won MV3 / YouTube-SPA patterns,
  each anchored to the code where it bites.
- [`CONTRIBUTING.md`](CONTRIBUTING.md) — dev setup, the test gate, and commit/PR
  conventions.
- [`PRIVACY.md`](PRIVACY.md) — the privacy policy (what's stored, what leaves your
  device, and to whom).
- [`CHANGELOG.md`](CHANGELOG.md) — notable feature milestones.
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — zero-context handoff: state, next steps,
  conventions, and a file map for picking the project back up.
- [`docs/PUBLISH_CHECKLIST.md`](docs/PUBLISH_CHECKLIST.md) — the actionable runway to
  a submitted Chrome Web Store listing (what's left + the steps).
- [`docs/STORE_SUBMISSION.md`](docs/STORE_SUBMISSION.md) — Chrome Web Store listing
  copy, permission justifications, and data-use disclosures (the detailed reference).
- [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) — the manual in-Chrome smoke-test
  checklist.
- [`docs/archive/`](docs/archive/) — completed planning / sprint docs, kept for
  history (the F1–F8 feature sprint, the F7 dashboards plans, the 2-agent worktree
  briefs).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the dev loop and conventions.
[`STATUS.md`](STATUS.md) is the live status doc. In short: feature work lands on
short-lived `feat/*` branches via PR, and every change is gated by `npm run
typecheck` + `npm test` (currently 49 passing unit tests) plus the relevant
[`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) checks before committing.

## License

[MIT](LICENSE) © Nathan Watkins. Third-party software and data (React; SponsorBlock
community data) are credited in [`NOTICE`](NOTICE).
