# TL;DW

TL;DW means "Too Long; Didn't Watch."
It is a Manifest V3 Chrome extension that turns a YouTube transcript into a concise, customizable summary with Google's Gemini.
TL;DW works with Gemini only ([docs/DECISIONS.md](docs/DECISIONS.md)).

## Product

- Works out of the box with no key: the TL;DW button under a video opens Gemini in a background tab and brings its answer back to the YouTube page.
- With your own free Gemini key, the summary appears on the page in seconds with no tab, from the Gemini API.
  It uses Gemini 3.5 Flash-Lite and switches to Gemini 3.1 Flash-Lite by itself when Google reports a rate or quota limit; a model picker offers larger models.
- Transcript first: TL;DW sends the transcript it read itself, with the time each line starts, in both modes.
  A long transcript goes whole, in several messages to the Gemini tab or in parts to the API, instead of being cut.
- Only without a transcript does Gemini get the video's link: with a key it watches the video; without one, a signed-out user is asked to sign in to Gemini, which can then read the captions.
- Four styles that look different on the page: Quick (the takeaway and three points), Research (claims and how the video backs each), Learning (key ideas as cards, and questions to test yourself) and Tutorial (numbered steps).
  Pick one as your default, or switch from the panel's ⋯ menu.
- Times appear only when they are checked: the model quotes the words it cites, and TL;DW shows the time only if those words are in the captions within 15 seconds of it. Click one to jump there.
- Automatic summaries can run for chosen channels or for videos over a set length.
- Optional SponsorBlock integration (off by default) skips community-reported sponsor segments.
- Summary activity, history and usage are stored locally.
- No shared developer key, backend, accounts, analytics or telemetry.

## Bring your own Gemini key (about 2 minutes)

1. Open [Google AI Studio API keys](https://aistudio.google.com/apikey) and sign in with your Google account.
2. Click "Create API key". A project just for TL;DW is optional.
3. Paste the key into TL;DW (the welcome page that opens on install, or Settings, Direct API). TL;DW verifies it with a metadata request and turns Direct API on.

The free tier needs no billing; its limits depend on the model and project ([rate limits](https://aistudio.google.com/docs/rate-limits)).
On the free tier, Google may use what you send to improve its products ([Gemini API terms](https://aistudio.google.com/docs/terms)).

## Privacy

The Gemini key stays in `chrome.storage.local` and is sent only to Google's Gemini API, in the `x-goog-api-key` header.
The full transcript is never persisted.
History stores the prompt that was sent, with the transcript replaced by a note of its length, and video metadata.
The summary cache keeps parsed summaries, prompt fingerprints, profile metadata and timestamps for up to seven days.
Direct API call logs store video URL, title, time, profile and outcome by default; full prompt and response bodies only when full call logging is on.

See [PRIVACY.md](PRIVACY.md) for what is sent where in each mode.

## Development

Node 24 is recommended (`.nvmrc`); Node 20.19 or newer builds.
No API key is needed to build or test.

```bash
npm install                        # npm 12+: npm install --allow-git=all
npx playwright install chromium    # once, for the browser tests
npm run typecheck && npm run lint && npm test && npm run test:e2e
npx vite build                     # production build into dist/
```

Load the unpacked extension from `dist/` (the folder holding `manifest.json`) through `chrome://extensions` with Developer mode on.
`npm run test:e2e` builds its own test build (with a short Gemini timeout) into `dist-e2e/`, so it never replaces the production build in `dist/`.
`npm run build` is the maintainer's release helper: it bumps the patch version, builds, and copies `dist/` to `TLDW_COPY_DIR` only when that variable is set.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the full workflow.

## Store package

```bash
npx vite build
npm run package
```

The first Chrome Web Store release is planned as an Unlisted soft launch.
See [docs/PUBLISH_CHECKLIST.md](docs/PUBLISH_CHECKLIST.md) and [docs/STORE_SUBMISSION.md](docs/STORE_SUBMISSION.md).

## Documentation

- [STATUS.md](STATUS.md) describes current release readiness.
- [PLAN.md](PLAN.md) describes product and architecture decisions.
- [docs/HANDOFF.md](docs/HANDOFF.md) provides a zero-context continuation point.
- [OWNER-TODO.md](OWNER-TODO.md) lists what only the owner can do: the Gemini key, the signed-in Chrome check and the Chrome Web Store submission.
- [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md) covers manual real-browser verification.
- [LESSONS_LEARNED.md](LESSONS_LEARNED.md) records extension engineering lessons.
- [CONTRIBUTING.md](CONTRIBUTING.md) covers the development workflow.

## License

[MIT](LICENSE) © Nathan Watkins.
Third-party software and SponsorBlock community data are credited in [NOTICE](NOTICE).
