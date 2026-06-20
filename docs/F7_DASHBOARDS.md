# F7 — Weekly / Monthly / Yearly Dashboards + Paid Analytics

_Planning doc. Status: PARKED (deferred from the 2026-06-19 sprint). This expands F7 from the one-paragraph backlog stub into a concrete, phased plan._

> **⚠️ Superseded on monetization.** This doc's lean toward "the analytics are the
> natural thing to charge for" (§1) and the "local-license unlock" (§3a) are **wrong** —
> see [`F7_PHASE1_PLAN.md`](F7_PHASE1_PLAN.md) §0. Short version: never charge for the
> user's own local data; ship Phase 1 free; the only real paid lever is **managed AI**
> (no BYO key), a separate product — not a gate on Phase 1. The Phase-1 engineering
> details below remain good.

## 1. What it IS (and what the "more than a Chrome extension" question means)

In the user's words: **"week / month / year dashboards of what they watched."** Today the Stats page (`StatsSection.tsx`) shows only **lifetime totals** + a rolling **12-week heatmap**. There is no "this week vs last week," no "what did June look like," no "2026 in review." F7 adds **time-windowed rollups**.

The second half — **"how do we make this more than a Chrome extension?"** — is the product/monetization question. The honest answer: the *analytics* are the natural thing to charge for, because (a) they get richer with more history, (b) a hosted/cross-device version is a real "beyond the browser" artifact, and (c) power users who watch a lot are exactly who'd pay. So F7 splits cleanly into:

- **Phase 1 (free, local, ships now):** time-windowed dashboards computed purely from data we already store. No backend, no privacy change, no payment. Pure value-add.
- **Phase 2 (the bet):** a *paid tier*. The real question is whether "paid" stays a fully-local unlock (a license key gating deeper local analytics) or becomes a real backend (accounts, sync, hosted web dashboard) — which **breaks today's "nothing leaves your browser" promise** and is therefore a deliberate, separable decision.

These are decoupled on purpose: **Phase 1 has zero dependency on the Phase 2 decision** and should ship regardless.

---

## 2. PHASE 1 — Local-only, free, ships now

**Goal:** week / month / year rollups on the existing Stats page, computed **purely from local data** already on disk. No new tracking, no backend.

### 2a. What data we already have vs. what's missing

| Need | Source today | Status |
|---|---|---|
| Per-video **timestamp** (for windowing) | `SearchHistoryEntry.createdAt` (ISO) | ✅ have |
| Per-video **engagement verdict** | `SearchHistoryEntry.userRating` (`watch`/`skim`/`skip`) | ✅ have |
| Per-video **channel** | `SearchHistoryEntry.channel` (+ `channelAvatarUrl`) | ✅ have |
| Per-video **duration / watched** (→ time saved) | `SearchHistoryEntry.durationSeconds`, `.watchedSeconds` | ✅ have |
| **Daily summary counts** (streaks, activity) | `LifetimeStats.activity: Record<"YYYY-MM-DD", number>` | ✅ have (capped 366 days) |
| **AI rating** per video | `SearchHistoryEntry.aiRating` | ✅ have |
| **Time saved**, windowable | derivable per-entry: `computeTimeSaved` logic over a *filtered* slice | ✅ derivable |

**The one real gap — and why it matters:** the rich per-video fields live in **`history`**, which is **pruned** (`historyLimit` 50/100/250/unlimited, and `autoExpireHistory` after N days). So `history`-derived windows are only complete back to the prune horizon. The **`activity` map is the only year-spanning series** but it holds *just a daily count* — no engagement/channel/time-saved breakdown. **Consequence:**

- **Week / month** windows → compute from `history` (almost always within the prune window; accurate).
- **Year / "all"** windows → counts/streaks from `activity` (spans up to 366 days); but engagement-breakdown / top-channels / time-saved for the full year are only as deep as `history` reaches. **Surface this honestly** ("breakdown reflects your last N saved videos") rather than silently undercounting.
- **Optional later (do NOT block Phase 1):** enrich `activity` from a flat count into a small per-day struct (`{ count, engaged, skimmed, skipped, savedSeconds }`) so year-level breakdowns survive history pruning. This is a `LifetimeStats` schema migration (default-merge on read, like the existing `getLifetimeStats`) — note it as a **Phase 1.5** follow-up, not a blocker.

### 2b. The new pure aggregation helper (the core of Phase 1)

Create **`src/lib/statsRollup.ts`** — a pure module, no `chrome.storage`, fully unit-testable (mirrors how `computeChannelStats`, `trimActivity`, `verdictCounterDelta` are already pure + tested):

```ts
export type Window = "week" | "month" | "year" | "all";

export type WindowRollup = {
  window: Window;
  rangeStart: string; rangeEnd: string;          // local-date bounds
  videoCount: number;                             // entries in window
  timeSavedSeconds: number;                       // Σ max(0,dur-watched) for skim/skip
  engagement: { engaged: number; skimmed: number; skipped: number };
  topChannels: { channel: string; count: number; avatarUrl?: string }[]; // top N
  activeDays: number;                             // days with ≥1 in window
  streak: number;                                 // reuse computeStreak semantics
  prev?: WindowRollup;                            // same-length prior window → deltas
};

export function rollupHistory(
  history: SearchHistoryEntry[],
  activity: Record<string, number>,
  window: Window,
  now: Date,
): WindowRollup;
```

Design rules:

- **Local calendar boundaries only.** Reuse `localDateKey` (from `constants`) for every boundary — the existing streak/heatmap code already learned the hard way that UTC slicing lands on the wrong day in negative-UTC zones (see the comment at `StatsSection.tsx:50`). Week = local week (match the heatmap's Sunday-start at `StatsSection.tsx:96`).
- **Reuse, don't duplicate.** `timeSavedSeconds` reuses the exact predicate in `computeTimeSaved` (`StatsSection.tsx:74`) — factor it into the helper and have the lifetime card call the same code over the full array. `topChannels` reuses `computeChannelStats` over the *filtered* slice. `streak`/`activeDays` reuse `computeStreak`'s consecutive-day walk.
- **`prev` window** powers "▲ 12% vs last week" deltas — cheap, high-value, no new data.
- **`inject`/timestamp note:** watch-progress stub entries get `createdAt = now`, so a video watched today windows to today even if first summarized weeks ago. Acceptable; document it.

### 2c. UI touchpoints

**`src/options/sections/StatsSection.tsx`:**
- Add a **window selector** (segmented control: Week · Month · Year · All) at the top of the section. Default **Week**.
- Re-point the existing hero cards (Videos summarized, Time saved, Engagement donut, Top channel) to read `rollup` for the selected window instead of `stats.*` lifetime fields. Keep a **"Lifetime"** tab (= `window:"all"`) so today's numbers aren't lost.
- Add **delta chips** ("▲/▼ vs last week") from `rollup.prev`.
- Add a **"Year in review" / period summary strip** (counts, time saved, top 3 channels, engagement split, best streak).
- Keep the 12-week heatmap as-is (it already IS a time view); optionally let the window selector scope its color scale.
- Keep the footer line **"All counted locally — nothing leaves your browser."** (`StatsSection.tsx:238`) — it stays true through all of Phase 1, and is a selling point.

**Move the pure helpers out of the component:** `computeTimeSaved`, `computeStreak`, `buildHeatmapGrid` currently live *inside* `StatsSection.tsx`. Migrate them into `statsRollup.ts` so they're covered by tests and reused by the rollup — this also shrinks the component.

**Tests — `src/lib/statsRollup.test.ts`** (the value of a pure helper):
- Window boundary correctness (entry at 23:59 local lands in today's window; DST week; year rollover Dec 31 → Jan 1).
- Negative-UTC-zone date-key correctness (the exact class of bug `computeStreak` warns about).
- Empty history / single entry / all-skip / all-engaged.
- `prev` window math and delta signs.
- Year window falling back to `activity` for counts while `history` is pruned (the documented partial-breakdown case).

### 2d. Phase 1 effort

**~1–1.5 days.** Mostly the pure helper + tests (half a day) and the StatsSection wiring + segmented control (half to full day). No schema change, no migration, no infra. **Ships standalone, low risk.** (Phase 1.5 `activity`-enrichment migration is a separate ~0.5 day if/when year-level breakdowns need to outlive pruning.)

---

## 3. PHASE 2 — The "beyond the extension" / paid layer

This is the actual product bet. Three decisions are entangled and must be made together: **(a) does data leave the device?**, **(b) what gates behind paid?**, **(c) how is the entitlement enforced?**

### 3a. What could gate behind paid (menu, not all-or-nothing)

- **Deeper local analytics:** full year-in-review, custom date ranges, channel-trend lines over time, "you're watching 30% less news than in Q1," CSV/JSON export, more than 12 weeks of heatmap, per-tag analytics (ties into F6).
- **Cross-device sync:** the same history/stats on every browser/profile.
- **Hosted web dashboard:** a real URL (`app.tldw.…`) showing the same data on a big screen / shareable "wrapped" card.

The **cheapest credible paid offering is "deeper local analytics behind a license key"** — no data leaves the device, minimal infra. Sync + hosted dashboard are the expensive, privacy-changing tier.

### 3b. The privacy tradeoff (call it out loudly)

Today: **nothing leaves the browser** — stated in the UI, and a genuine differentiator vs. every "watch analytics" SaaS. Any **sync or hosted dashboard inverts this**: you now custody users' YouTube-watching history on a server. That demands a privacy policy rewrite, a data-deletion path, Chrome Web Store "remote code / data collection" disclosures, and arguably E2E encryption to keep the spirit of the promise. **This is the single biggest cost/risk in the whole epic — not the code.**

### 3c. Three architecture options

**Option A — Fully-local premium unlock (license key).**
A paid license key unlocks Phase-1+ analytics that still run entirely on-device. Sell keys via Gumroad/Lemon Squeezy/Stripe Payment Links. Validate either fully offline (signed key — Ed25519 public key shipped in the extension, verify a signed entitlement blob the user pastes) or with a thin "is this key valid" endpoint cached for N days with offline grace.
- **Pros:** privacy promise **unchanged**; near-zero infra; fastest to ship; no PII custody; works in incognito.
- **Cons:** key-sharing/piracy (mitigate with signed keys, accept some leakage — it's a $X tool, not enterprise); no cross-device sync; no hosted dashboard ("more than a Chrome extension" stays aspirational).
- **Effort:** **~3–5 days** (entitlement check, gating UI, paywall, a payment-link checkout). No servers to run.

**Option B — Real backend with accounts + sync + hosted dashboard.**
Auth (Google sign-in), a server datastore, an extension sync engine (push local deltas, pull on other devices), a hosted web app rendering the same rollups, Stripe subscriptions + webhooks driving entitlement.
- **Pros:** genuinely "beyond a Chrome extension"; cross-device; shareable "wrapped"; recurring revenue; analytics improve server-side (cohorts, trends).
- **Cons:** **breaks the privacy promise**; ongoing infra + on-call + cost; legal/compliance (privacy policy, GDPR delete, CWS disclosures); sync conflict-resolution is real work (the storage layer already fights `chrome.storage` write races *locally* — a multi-device merge is strictly harder); slowest to ship.
- **Effort:** **~3–6 weeks** for a credible v1, plus permanent operational tail.

**Option C — Hybrid: local-first + optional encrypted sync (recommended shape if we ever go "beyond").**
Analytics stay **local-first and free-ish**; paid unlocks **opt-in, end-to-end-encrypted sync** (the server stores ciphertext keyed by a passphrase it never sees) and a hosted dashboard that decrypts client-side. Entitlement via Stripe + a thin license endpoint (Option A's mechanism).
- **Pros:** keeps most of the privacy story ("we can't read your data, even synced"); delivers the cross-device + hosted-dashboard "more than an extension" story; degrades gracefully offline.
- **Cons:** E2E + key management is the hardest engineering here (passphrase recovery, key rotation); hosted dashboard must do crypto in-browser; still need a privacy policy and disclosures (less alarming, but required).
- **Effort:** **~4–8 weeks**; highest ceiling, highest complexity.

### 3d. Recommendation

1. **Ship Phase 1 now**, unconditionally — pure local rollups, no gating. It's the cheap 80%.
2. For monetization, **start with Option A** (signed-license unlock of deeper *local* analytics). It validates "will people pay for this?" with days of work and **zero privacy regression** — keep "nothing leaves your browser" as the headline even for paid users.
3. **Only graduate to Option C** if (a) Option A shows real paid demand **and** (b) users explicitly ask for cross-device/hosted. Treat sync as a distinct, later epic with its own privacy-policy + security review gate. **Avoid Option B's plaintext server** — it spends the privacy differentiator for no extra user benefit over C.

---

## 4. Risks, sequencing, effort

### Sequencing

```
Phase 1 (local rollups, free)         ──ships independently, no gating──┐
  └─ Phase 1.5 (activity-map enrich)   optional, only if year breakdowns must outlive pruning
                                                                        │
Phase 2a (Option A license unlock)    ──after P1 proves the UX, validates demand──┐
                                                                                  │
Phase 2c (Option C E2E sync + hosted) ──only if A sells AND users ask; own security-review gate──┘
```

### Risks

- **(P1) Date-boundary bugs** — the codebase has a documented history of UTC-vs-local off-by-one (streak, heatmap). *Mitigation:* pure helper + the negative-UTC/DST/year-rollover test cases above.
- **(P1) Pruned-history undercount** — year/all windows look "wrong" because `history` was trimmed. *Mitigation:* label partial breakdowns honestly; offer Phase 1.5 enrichment if it matters.
- **(P2) Privacy regression** is the dominant risk — reputational, legal (GDPR/CWS), and it forfeits the differentiator. *Mitigation:* prefer local-only (A) → E2E (C); never plaintext server (B).
- **(P2) Piracy / key-sharing** in Option A. *Mitigation:* signed keys, accept modest leakage; it's a consumer tool.
- **(P2) Sync correctness** — multi-device merge is harder than the local write-race work already done. *Mitigation:* defer; treat as its own epic with conflict-resolution design + tests.
- **(P2) Operational + compliance tail** of any backend (cost, on-call, privacy policy, deletion endpoint, store disclosures).

### Effort summary

| Phase | Scope | Effort |
|---|---|---|
| **1** | `statsRollup.ts` + tests, StatsSection window selector + deltas + period strip | **~1–1.5 days** |
| **1.5** (opt) | `LifetimeStats.activity` count → per-day struct migration | **~0.5 day** |
| **2a (Option A)** | Signed-license entitlement, paywall/gating, payment-link checkout | **~3–5 days, no infra** |
| **2c (Option C)** | E2E-encrypted sync engine + hosted decrypt-in-browser dashboard + Stripe subs | **~4–8 weeks + ops tail** |

**Bottom line:** Phase 1 is a near-free win — build it next time F7 surfaces. The "paid / beyond-the-extension" layer is a real bet; start with a local-only license unlock (Option A) to test demand before spending the privacy promise on a backend.
