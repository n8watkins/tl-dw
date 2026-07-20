# TL;DW

TL;DW means "Too Long; Didn't Watch."
It is a Manifest V3 Chrome extension that turns a YouTube transcript into a concise, customizable summary.

## Product

- Direct API mode calls Gemini 3.1 Flash-Lite with a Gemini key supplied by the user and renders the summary on YouTube.
- Gemini 3.1 Flash-Lite is recommended because it currently offers the highest free-tier allowance at up to 500 requests per day as of July 2026.
- Users can remain on the free tier or attach billing to their own Google project for additional capacity.
- TL;DW has no shared developer key, developer backend, accounts, analytics, or telemetry.
- Open-in-a-tab mode supports Gemini, ChatGPT, Claude, and NotebookLM using the user's existing signed-in sessions.
- Prompt profiles, channel and video tags, and specific questions shape the generated summary.
- Automatic summaries can run for selected channels or videos over a configured duration.
- SponsorBlock integration can skip community-reported sponsor segments.
- Summary activity, history, and usage are stored locally.

## BYOK privacy

The Gemini key remains in `chrome.storage.local`.
TL;DW sends it only to Google's Generative Language API in the `x-goog-api-key` header.
Key setup saves the key locally first, then verifies access to Gemini 3.1 Flash-Lite with a metadata request.
Verification does not count as a summary request.

The full transcript is never persisted.
History stores a transcript-free prompt and video metadata.
The prompt-aware summary cache stores parsed summaries, prompt fingerprints, profile metadata, destination or model, and timestamps for up to seven days.
Direct API call logs store video URL, title, timestamp, profile, and outcome by default.
Full prompt and response bodies are stored only when full call logging is enabled.

See [PRIVACY.md](PRIVACY.md) for the complete policy.

## Development

Node 20.19 or newer is required.

```bash
npm install
npm run typecheck
npm test
npx vite build
```

`npm run build` is the development release helper and increments the patch version before building and copying to the configured Windows extension directory.
Use `npx vite build` when a non-bumping production build is required.

Load the unpacked extension from `dist/` or from the copied Windows directory through `chrome://extensions`.
The default command is `Alt+Shift+G` and can be confirmed at `chrome://extensions/shortcuts`.

## Store package

```bash
npx vite build
npm run package
```

The 1.0.0 release is planned as an Unlisted Chrome Web Store soft launch.
See [docs/PUBLISH_CHECKLIST.md](docs/PUBLISH_CHECKLIST.md) and [docs/STORE_SUBMISSION.md](docs/STORE_SUBMISSION.md).

## Documentation

- [STATUS.md](STATUS.md) describes current release readiness.
- [PLAN.md](PLAN.md) describes product and architecture decisions.
- [docs/HANDOFF.md](docs/HANDOFF.md) provides a zero-context continuation point.
- [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md) covers manual real-browser verification.
- [LESSONS_LEARNED.md](LESSONS_LEARNED.md) records extension engineering lessons.
- [CONTRIBUTING.md](CONTRIBUTING.md) covers the development workflow.

## License

[MIT](LICENSE) © Nathan Watkins.
Third-party software and SponsorBlock community data are credited in [NOTICE](NOTICE).
