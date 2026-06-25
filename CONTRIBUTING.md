# Contributing to TL;DW

Thanks for your interest. TL;DW is a Manifest V3 Chrome extension (TypeScript +
Vite + React for the popup/options, vanilla TS for the content scripts).

## Prerequisites

- **Node 18+** (the Vite toolchain and the ESM `.mjs` build scripts assume a modern
  Node).
- Google Chrome 111+ (a content script uses `world: "MAIN"`, honored from 111).

## Setup & dev loop

```bash
npm install
npm run dev        # Vite dev server, live iteration, no version bump
```

Load the unpacked extension from `chrome://extensions` (Developer mode → Load
unpacked). See the README for the build-and-copy-to-Windows flow (`npm run build`),
which bumps the patch version every run so the popup version always changes.

## The quality gate (run before every commit)

```bash
npm run typecheck  # tsc --noEmit
npm test           # vitest run — currently 113 passing unit tests
```

Tests cover the **pure helpers** in `src/lib/` (engagement, stats, dashboards,
history, promptBuilder, tldw, profiles). DOM/content-script behavior and the React
UI are not unit-tested, so for anything that touches the on-page widget, the popup,
or the options pages, also walk the relevant sections of
[`docs/SMOKE_TEST.md`](docs/SMOKE_TEST.md) in a real browser.

## Where things live

- [`STATUS.md`](STATUS.md) — what's built, known bugs, architecture map, next steps.
- [`PLAN.md`](PLAN.md) — the product thesis and how the core inject-and-submit motion
  works.
- [`LESSONS_LEARNED.md`](LESSONS_LEARNED.md) — **read this before touching the content
  scripts.** Hard-won MV3 / YouTube-SPA patterns (storage write-locking, nav-epoch
  staleness, MAIN-world interception, graceful selector fallbacks), each anchored to
  the code. Source comments reference these by number.
- [`docs/archive/`](docs/archive/) — completed planning/sprint docs, kept for history.

## Branching & PRs

- Feature work lands on short-lived `feat/*` branches via PR; fixes on `fix/*`.
- Larger efforts have used a two-parallel-agent worktree split (data/prompt layer vs
  the `src/content/youtube.ts` widget) with disjoint file ownership so the streams
  never conflict — see the archived briefs under
  [`docs/archive/agents/`](docs/archive/agents/) for that pattern.

## Commit style

Conventional-style messages with a scope, e.g.:

```
feat(F7 P1): week/month/year dashboard UI on the Stats page
fix(widget): popover leak on rapid SPA nav
docs: correct the test count and archive completed plans
```

## Out of scope (don't re-propose)

Some directions were deliberately declined. Check **"Not doing"** in
[`STATUS.md`](STATUS.md) (e.g. transcript-derived key-moments/seek-links, and the
YouTube Data API — TL;DW relies on DOM scraping + intercepted network data only)
before building on them.
