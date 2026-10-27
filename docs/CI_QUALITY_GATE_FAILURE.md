# CI Quality gate failure on master

Diagnosed 2026-10-26.
No code was changed for this report.

## Summary

The `Quality gate` workflow (`.github/workflows/ci.yml`, job `verify`) has failed on both master runs since it was added on 2026-07-20.
The runs are 29785129872 (`7366ac6`) and 29815938797 (`7de51c7`).
Both fail at the **Unit tests** step (`npm test`).
Typecheck and Lint pass; every later step was skipped.
The full logs have expired (`gh run view --log-failed` returns HTTP 410), so the error below comes from the check-run annotations.

## Exact error

```
src/lib/storage.test.ts > trimActivity - trim to the newest maxKeys dates > trims to the newest maxKeys dates when over the cap
AssertionError: expected '2024-01-05' to be '2024-01-04' // Object.is equality
 ❯ src/lib/storage.test.ts:27:21
```

## Root cause

### 1. Timezone-dependent test (the current CI failure)

This is a bug in the test, not in `trimActivity`, and it is not flaky: it fails every time in UTC and passes every time in US Pacific time.
The test builds its fixture with `new Date("2024-01-01")` (parsed as UTC midnight), then advances it with `setDate`/`getDate` (local time) and reads it back with `toISOString()` (UTC).
On the GitHub runner (TZ=UTC) this produces 370 distinct dates, 2024-01-01 through 2025-01-04.
Keeping the newest 366 drops four dates, so the first kept key is `2024-01-05`.
On the owner's machine (America/Los_Angeles), the local 16:00 anchor shifts to 23:00 UTC after the March DST change, so one ISO date repeats and only 369 distinct keys exist.
Then only three dates are dropped and the first kept key is `2024-01-04`, which matches the assertion.
The in-code comment ("The 4 oldest (2024-01-01 … 2024-01-03)") lists only three dates, which shows the expectation was written to match the local result.
`trimActivity` itself is correct: it keeps the 366 lexicographically newest `YYYY-MM-DD` keys.

Reproduced locally with the repo's own scripts:

- `npx vitest run src/lib/storage.test.ts` passes (local TZ, PDT).
- `TZ=UTC npx vitest run src/lib/storage.test.ts` fails with the exact CI assertion.

### 2. Wall-clock time bomb (will fail the next CI run as well)

`src/lib/summaryCache.test.ts > summary cache variants > replaces the same video and fingerprint while retaining other variants` now fails in every timezone:

```
AssertionError: expected [] to have a length of 2 but got +0
 ❯ src/lib/summaryCache.test.ts:50:29
```

Its fixtures use a fixed `createdAt` of `2026-07-20T12:00:00.000Z`.
`upsertCachedVariant` calls `pruneSummaryCache` with the default `now = Date.now()`, and `CACHE_TTL_MS` is 7 days.
Since 2026-07-27 every fixture entry is treated as expired and pruned, so the result is empty.
This test passed in the July CI runs only because they ran within the 7-day window.

### 3. `npm audit` now fails (final step)

`npm audit` exits 1 with 11 advisories (3 moderate, 8 high) published after July.
They include direct dev dependencies `vite@7.3.6` (fix: 7.3.7) and `vitest@4.1.10` (fix: 4.1.12), plus transitive `brace-expansion`, `browserslist`, `baseline-browser-mapping`, `js-yaml`, `nanoid`, `postcss`, `source-map-js` and `zod`.
All have non-major fixes available.
This is dependency drift, not a code bug, but it will turn the gate red again as soon as the unit tests are fixed.

### Steps that pass

Run locally under `TZ=UTC` on Node 24.16.0 in a clean worktree of `origin/master` after `npm ci`:

- `npm run typecheck`, `npm run lint`: pass.
- `npm run test:e2e` (built extension in Playwright Chromium): 9/9 pass.
- `npx vite build`, `npm run package`, `npm run validate:package`: pass.

## Classification

| Issue | Type |
| --- | --- |
| `storage.test.ts` trimActivity | Real test bug (timezone-dependent fixture), exposed by CI running in UTC |
| `summaryCache.test.ts` upsert | Real test bug (depends on the real clock), now fails everywhere |
| `npm audit` | Dependency drift (new advisories) |

None of these is a product bug, a flaky test, or a runner/tooling change.
The workflow also warns that `actions/checkout@v4` and `actions/setup-node@v4` target the deprecated Node 20 Actions runtime; that is a warning only, not a cause.

## Recommended fix

1. **storage.test.ts (about 5 minutes).**
   Build the fixture purely in UTC, for example `const d = new Date(Date.UTC(2024, 0, 1 + i))`.
   Assert `keys[0]` is `"2024-01-05"` and fix the comment to list the four dropped dates.
2. **summaryCache.test.ts (about 10 minutes).**
   Make the test independent of the real clock, either with `vi.useFakeTimers()` plus `vi.setSystemTime(new Date("2026-07-20T12:00:00.000Z"))` in that test, or by giving `upsertCachedVariant` an optional `now` parameter that it passes to `pruneSummaryCache`, matching the signature `pruneSummaryCache` already has.
   The `now` parameter is the cleaner long-term option because it keeps the pure helper deterministic.
3. **Guard against regressions (about 5 minutes).**
   Pin the test timezone so local runs match CI: set `process.env.TZ = "UTC"` in a Vitest `globalSetup` (or `TZ=UTC` in the `test` script).
   Optionally run the unit tests once more in a non-UTC zone in CI to catch similar fixtures.
4. **npm audit (about 15-30 minutes).**
   Bump `vite` to 7.3.7 and `vitest` to 4.1.12 (both pinned exactly), run `npm audit fix` for the transitive packages, then rerun the full gate including the e2e tests.
5. **Optional housekeeping.**
   Move `actions/checkout` and `actions/setup-node` to their Node 24 majors.
   `CONTRIBUTING.md` still says "Node 18+" and "49 passing unit tests"; the repo requires Node >=20.19.0 and has 87 unit tests.

Total effort is roughly one hour including a full gate rerun.
