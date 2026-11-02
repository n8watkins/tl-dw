# Contributing to TL;DW

Thanks for your interest.
TL;DW is a Manifest V3 Chrome extension: TypeScript and Vite, React for the popup and options pages, and plain TypeScript for the content scripts.

## Prerequisites

- Node 24 (see `.nvmrc`; `nvm use` picks it up). Node 20.19 or newer still builds.
- Google Chrome 116 or newer.
- No API key is needed to build, test or run TL;DW.

## Setup

```bash
npm install            # npm 12+: npm install --allow-git=all (release-kit is a GitHub dependency)
npx playwright install chromium   # once, for the browser tests
npx vite build         # production build into dist/
```

Load the extension from `chrome://extensions`: turn on Developer mode, click "Load unpacked" and pick the `dist/` folder (the one that holds `manifest.json`).
After a rebuild, click the reload icon on the TL;DW card and reload any open YouTube tabs.

`npm run dev` runs the Vite dev server for live iteration.

`npm run build` is the maintainer's helper: it bumps the patch version, builds, and, only when `TLDW_COPY_DIR` is set, copies `dist/` to that folder (for example a Windows folder Chrome loads from under WSL).
Forks can ignore it and use `npx vite build`.

## The quality gate (run before every commit)

```bash
npm run typecheck   # tsc --noEmit
npm run lint        # eslint, zero warnings
npm test            # vitest unit tests, always in UTC
npm run test:e2e    # builds dist-e2e/ and runs the Playwright tests against the built extension
```

The unit tests cover the helpers in `src/lib/`.
The Playwright tests load the built extension in Chromium and drive the popup, the options page and the on-page panel against local YouTube, Gemini and chat-site stand-ins, so they need no network and no key.
For changes to the on-page widget or the destination sites, also walk the relevant parts of [`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) in a real browser.

### Optional: live Gemini API check

`npm run smoke:gemini` checks the configured Gemini models against the real API.
It needs `GEMINI_API_KEY` in the environment and skips itself when the variable is missing.
If you use [pass-env](https://github.com/n8watkins/pass-env), `.env.pass` names the entry (names only, never values): `pass-env run -- npm run smoke:gemini`.
Otherwise export the variable yourself; never commit a key.

## Releases

Releases use [release-kit](RELEASING.md) and run only in the upstream repository (`n8watkins/tl-dw`); the release workflow skips itself in forks.
Forks don't need it: `npx vite build` and `npm run package` produce a loadable folder and a store ZIP.

## Where things live

- [`STATUS.md`](STATUS.md): what's built, known bugs, architecture map, next steps.
- [`PLAN.md`](PLAN.md): the product thesis and how the inject-and-submit flow works.
- [`LESSONS_LEARNED.md`](LESSONS_LEARNED.md): read this before touching the content scripts. Hard-won MV3 and YouTube single-page-app patterns, each anchored to the code.
- [`docs/archive/`](docs/archive/): completed planning documents, kept for history.

## Branching and pull requests

- Feature work lands on short-lived `feat/*` branches via pull request; fixes on `fix/*`.
- Commit messages follow Conventional Commits; see [RELEASING.md](RELEASING.md).

## Out of scope (don't re-propose)

Some directions were deliberately declined.
Check "Not doing" in [`STATUS.md`](STATUS.md) (for example transcript-derived key moments and the YouTube Data API: TL;DW relies on the page and intercepted network data only) before building on them.
