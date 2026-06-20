# F7 Phase 1 — Free Local Dashboards: the plan + "what would we actually charge for?"

> **📦 ARCHIVED — Phase 1 IMPLEMENTED & MERGED (PR #2, 2026-06-20), kept for history.**
> The "Nothing built yet" note below is obsolete — `src/lib/dashboards.ts`, its 14
> tests, and the Stats-page window toggle all shipped. The live status doc is
> [`STATUS.md`](../../STATUS.md). This doc is retained as the **monetization decision
> record** (§0 "don't charge for local data") and for the still-open Phase 2 bet.

_Plan for review (2026-06-20). Nothing built yet. Supersedes the monetization
framing in [`F7_DASHBOARDS.md`](F7_DASHBOARDS.md) §1/§3a._

---

## 0. The monetization question, answered first (it's the real one)

**Your instinct is right: you don't charge for the user's own local data.** The
Stats page computes everything from data the user generated, on their machine,
with their CPU. Phase 1 is just *more pure math over the same local arrays*.
Gating a `reduce()` over someone's own history behind a license key is charging
rent on their own data — and it has none of the properties that make a thing
worth money:

- **No marginal cost to us** — a week/month/year rollup runs in the user's browser
  whether they paid or not. We're not selling a thing, just permission to run code
  that already shipped.
- **No moat** — it's a loop over an array; the repo is public, so anyone (or a fork)
  reproduces it in an afternoon. A client-side gate on an open-source extension is
  decorative — it only charges the honest users.
- **It contradicts the whole pitch** — "everything is local, nothing leaves your
  browser, no accounts." A meter on *your own June* feels adversarial.

So the existing F7 doc's lean ("analytics are the natural thing to charge for") is
wrong, and a "local-license unlock" is the worst option (DRM to defend a `reduce()`).

### What IS genuinely chargeable

The honest test: a thing is fairly paid only if it **(a) costs us ongoing money**,
or **(b) does something local structurally cannot.**

| Candidate | Costs us $? | Impossible locally? | Worth paying for? |
|---|---|---|---|
| Deeper local dashboards | No | No | **No — give it away** |
| **Managed AI** (no BYO key — we hold the key, eat the API cost) | **Yes** | Yes (no key → no local path) | **Yes — clearest case** |
| Cross-device **sync** (history/tags/stats) | Yes | **Yes** | Yes, for multi-device users |
| Hosted **web dashboard** ("year in review" anywhere / shareable) | Yes | Yes | Mostly a funnel, not a product |
| Server-side **AI digests** ("what you learned this month") | Yes (real compute) | Partly | Niche add-on, later |
| "Higher limits" | Only under managed AI | No | **Not ours to sell** (it's Google's cap on the user's key) |

Everything genuinely chargeable means **we run a server and/or eat a bill.** Nothing
chargeable is "the user's own local data, computed locally."

### The serious default: don't monetize at all (yet)

The codebase already leans this way — `SupportSection` ships Buy-Me-A-Coffee + a
GitHub link, and `TierBadge`'s own comment says "no gating logic." For a BYO-key,
privacy-first indie extension, willingness-to-pay is low (the AI is already free via
the user's key), and a paywall would convert a tiny fraction while spending the one
real differentiator (100% local, no accounts). **Free + local + donations + a
portfolio/funnel play is a respectable, possibly correct, end state.**

### Recommendation (decisive)

1. **Ship Phase 1 free, local, ungated, now.** Don't let any monetization question
   block it — it has zero dependency on the paid decision.
2. **Never gate local dashboards.** Drop the "local-license unlock" idea entirely.
3. **Default to free + local + donations.** Keep the BMAC link; treat the extension
   as a reputation/funnel asset.
4. **If you ever monetize, it's the hosted/managed layer — a separate product.** The
   one thing worth charging for is **managed AI (no BYO key)**: real recurring COGS,
   removes real friction, barely dents privacy (disclose it; keep BYO as the free
   path). Sync + hosted "year in review" come after that proves demand, behind a
   privacy-policy + security-review gate.

**One-liner:** _We don't charge for your own local data. Every local dashboard is
free. The only thing worth charging for is the layer that costs us money or does
what local can't — managed AI first, sync/hosted later — and that's its own product,
not a gate on Phase 1._

---

## 1. What Phase 1 IS — and the product cut

A **window selector** on the existing Stats page: **Week · Month · Year · All-time**
(All-time = today's page, unchanged). Week/Month/Year show the core metrics with a
**delta vs the prior window** (▲/▼). The point isn't charts — it's answering
questions the user actually has. **If a tile doesn't answer a real question, cut it.**

### The 3 hero insights (the reason to open it weekly)

1. **"Time TL;DW gave back."** The headline, as a *sentence*: _"This week TL;DW saved
   you 2h 40m — 41 videos you didn't watch in full."_ (Σ `duration − watched` for
   skim/skip over the window) + a week-over-week delta. This one line justifies the
   install; the delta is what makes it *recurring*.
2. **"Finish-rate, this period."** Re-slice the engaged/skimmed/skipped donut per
   window: _"68% of what you opened, you finished — up from 52% last month, you're
   picking better."_ The lifetime donut can never move; the windowed one *changes*,
   which is why it's worth checking.
3. **"What you've been watching — as a verdict, not a list."** Top channels by *time
   spent*, each tagged with its engagement mix: _"3h on MrWhoseTheBoss — engaged with
   90%. Worth it."_ vs _"1h 20m on X — skipped 80%. Junk?"_

### The one behavior-change feature (where stickiness lives)

**The skip-rate → block nudge.** When a channel in the window has high count + high
skip rate (e.g. ≥5 videos, ≥70% skipped), surface: _"You've skipped 8 of 10 [Channel]
this month. Block it from TL;DW?"_ — wired straight to the **existing
`addBlockedChannel()`** helper. It turns a passive stat into a one-click declutter,
and it's uniquely ours (nothing else knows your skip pattern).

### What to AVOID (vanity / chart junk)

- "Videos summarized" as a hero (activity-vanity — keep as small context only).
- "Channels explored," "API calls," "hours previewed" — trivia, no real question.
- The **streak 🔥** as a driver — a "watch more to keep your streak" loop is
  *adversarial to our own value prop* (we save time; don't gamify time-wasting).
- Repeating the heatmap per window; `avgAiRating` (the model's opinion, not yours).
- Any chart without a one-line plain-English read above it.

> **The cut:** if Phase 1 ships exactly **(1) time-saved + WoW delta, (2) finish-rate
> trend, (3) skip-rate → block nudge**, that's the whole valuable product. The first
> two give a reason to open weekly; the third gives a reason to *act*.

---

## 2. Data-model reality (where each metric comes from)

Three stores, three granularities — get this right or numbers silently lie:

- **`history[]`** (`getHistory`) — **timestamped + rich**: per entry `createdAt`,
  `channel`, `userRating`, `watchedSeconds`, `durationSeconds`, `aiRating`. **This is
  the windowing engine** — filter by `createdAt`, then aggregate. Source for: time
  saved, engagement breakdown, top channels, hours previewed.
- **`tldwStats`** — lifetime scalars (`sponsorSecondsSaved`, `cacheHits`,
  `secondsWatched`…). **No timestamps → cannot be windowed.** All-time render only.
- **`activity: Record<"YYYY-MM-DD", number>`** — **daily summary counts** (capped
  366 days). Source for: the **"videos summarized" count** (survives history pruning)
  and "active days in window." Carries no channel/time/rating.

**Two honest caveats to surface in-UI:**
- **"Videos summarized" count** comes from `activity` (real "summaries run," survives
  pruning); **rich metrics** come from `history[]` — they're allowed to differ.
- **History auto-expires** (`autoExpireHistory`/`historyLimit`), so windowed rich
  metrics under-count once old entries are pruned — most visible in **Year**. Show a
  _"based on N days of retained history"_ footnote; never ship a year number that
  silently lies. (Pruning-proof year stats = the Phase-2 daily-rollup store, below.)

**Not windowable today (kept in All-time, not faked):** sponsor time skipped, API
calls, cache hits, lifetime watch time.

**Per-day rollup store?** Not for Phase 1. A `tldwDailyRollup` keyed by date would
make *everything* windowable + pruning-proof, but it's a new write path through every
stats-bump site + a migration. Note it as the clean next unlock; don't build it yet.

---

## 3. Engineering plan

### Aggregation layer — new pure module `src/lib/dashboards.ts` (fully tested, no `chrome.*`/React)
```ts
export type WindowKind = "week" | "month" | "year";
export type DateRange = { start: Date; end: Date };           // local midnights, [start, end)
export type WindowStats = {
  range: DateRange; summaries: number;            // count from activity
  videosWithMeta: number; timeSavedSeconds: number; hoursPreviewedSeconds: number;
  engagement: { engaged: number; skimmed: number; skipped: number };
  topChannels: ChannelStats[]; uniqueChannels: number; activeDays: number;
};
export type WindowComparison = { current: WindowStats; previous: WindowStats };

export function rangeFor(kind, now): DateRange            // calendar-aware (this month = this calendar month)
export function priorRange(range, kind): DateRange        // prior CALENDAR window, not "30 days ago"
export function windowStats(history, activity, range): WindowStats
export function compareWindows(history, activity, kind, now): WindowComparison
export function pctDelta(cur, prev): { pct: number|null; dir: "up"|"down"|"new" }
```
All date math via `localDateKey` + local-time components (timezone-correct, matching
the streak/heatmap writers). Move the existing `computeTimeSaved` here (kills the
duplicate in StatsSection). Tests: `dashboards.test.ts` — calendar boundaries, 23:30
local edge, empty/new-user (no NaN/∞), prior-window "new" case, pruning under-count.

### UI — a toggle in `StatsSection.tsx` (not a new page)
- Segmented control `[ Week | Month | Year | All-time ]` (neon active state).
- All-time → today's exact layout (untouched, lowest risk).
- Window views → grid of the core cards (reuse `DonutChart`, `.stat-card`, the
  `--ca/--cg` glow vars) + a tiny new `<DeltaChip current prev />` (green ▲ / red ▼ /
  neutral "new"). One `useState<WindowKind|"all">`; compute via `useMemo` keyed on
  `[history, activity, kind]` — **no new storage reads**, purely derived.
- Only new CSS: `.stats-window-toggle`, `.stat-delta`. Keep the neon aesthetic.

### Acceptance criteria
- [ ] Toggling windows swaps the view with **no storage reads** (derived only).
- [ ] Each windowed metric shows value + prior-window delta; "new" (not ∞/NaN) when prior is empty.
- [ ] Window math timezone-correct (23:30-local entry counts in that day); `priorRange` calendar-aware.
- [ ] No metric silently wrong: sponsor/API/cache absent from windows (kept in All-time).
- [ ] All-time view byte-identical to today; empty/new-user state friendly, no throw.
- [ ] The 3 hero insights + the block nudge present; nudge calls existing `addBlockedChannel`.
- [ ] `npm test` green incl. `dashboards.test.ts`; `npm run typecheck` clean; no new deps; nothing leaves the browser.

### Build sequence (commit per step) + effort
1. `src/lib/dashboards.ts` (date helpers + window/compare/delta; absorb `computeTimeSaved`).
2. `src/lib/dashboards.test.ts` (gate everything on green — steps 1–2 are ~60% of the work).
3. `<DeltaChip>` + `.stat-delta` CSS.
4. Window toggle + windowed grid in `StatsSection` (hero cards + the block nudge).
5. (optional) sparkline via a daily series — defer if tight.

**Effort: ~1 day** for a polished Phase 1 (half on the tested module, half on UI reusing existing cards). The daily-rollup store is explicitly Phase-2.

---

## 4. What I need from you
- **Sign-off on the monetization stance** (ship local free; don't gate; managed-AI is the only real paid lever, later & separate).
- **The cut** — ship the focused 3 heroes + block nudge, or the fuller card grid?
- Then I'll build Phase 1 (it's a clean ~1-day, well-tested, behavior-safe change).
