# Publish to the Chrome Web Store — Checklist

The actionable runway to a submitted listing. Detailed copy, permission
justifications, and data-use answers live in
[`STORE_SUBMISSION.md`](STORE_SUBMISSION.md); this is the "what's left + do these"
tracker.

**Where we are (2026-06-25):** Version **0.1.173**, **49 tests**. Compliance audit
passed — 49/49 requirements clear, **0 code or policy blockers**. All listing text,
permission justifications, the privacy policy, and the upload package are ready. The
only things standing between you and "Submit" are **two graphics** and the
**developer account**.

> **Reduced data collection since the audit (privacy win for review).** The
> watch-time engine (`watchtime.ts`) and its data-layer modules (`engagement.ts`,
> `dashboards.ts`, `stats.ts`) were **deleted**: TL;DW no longer tracks watch-time or
> engagement at all, and the on-page panel is **summary-only** (no WATCH/SKIM/SKIP
> verdict, no AI rating, no worth-watching gate, no engagement cue). The shipped build
> therefore collects *less* user data than the audited one — strictly easier to clear
> review. `STORE_SUBMISSION.md` was re-checked against this (single-purpose, data-use,
> and the `youtube.com` host justification all updated; **every declared permission +
> host is still exercised by a surviving feature** — see the re-check below).

---

## 🔴 Hard blockers — only you can make these

The dashboard will not let you submit for review until both exist.

- [ ] **At least one screenshot, 1280×800** (up to 5 recommended). Shot-list with
      exactly what to capture is in [`STORE_SUBMISSION.md` §5](STORE_SUBMISSION.md).
- [ ] **Small promo tile, 440×280.** Design brief is in
      [`STORE_SUBMISSION.md` §5](STORE_SUBMISSION.md). (The 1400×560 marquee tile is
      optional.)

## 🟠 Developer account (one-time)

- [ ] Register at <https://chrome.google.com/webstore/devconsole>
- [ ] Pay the one-time **$5** registration fee
- [ ] **Enable 2-Step Verification** on the publishing Google account (required — the
      dashboard blocks publishing without it)
- [ ] Verify your contact email (the account email can't be changed later)

## 🟡 Verify before submitting (changes we couldn't runtime-test)

- [x] **Listing text accuracy** — [`STORE_SUBMISSION.md`](STORE_SUBMISSION.md) re-checked
      against the shipped UI (it had depended on now-removed claims): no "block channel"
      wording (block feature removed), **no WATCH/SKIM/SKIP verdict, AI rating, or
      watch-time/engagement claims** (deleted — removed from the description, feature list,
      single-purpose, data-use, and the `youtube.com` host justification), the brand-logo
      §7 note matches the inline-SVG reality (no bundled `claude-icon.png`), 4 destinations
      (no Perplexity), and the version reference is `0.1.173`.
- [x] **Permission/host re-check after the decoupling** — with `watchtime.ts` deleted,
      confirmed against [`src/manifest.config.ts`](../src/manifest.config.ts) that every
      declared permission (`storage`, `tabs`, `contextMenus`, `clipboardWrite`) and every
      host is still exercised by a surviving feature (the `youtube.com` content scripts
      still run for the summary panel + transcript intercept + SponsorBlock; `tabs` /
      `contextMenus` / `clipboardWrite` by the open-in-a-tab flow). **No permission or
      host became unjustified.**
- [ ] **Direct API live-key test** — run one Direct-API summary with a real Gemini
      key to confirm the new `x-goog-api-key` header call still works.
- [ ] **First-run notice** — load the latest build, open the popup once, confirm the
      SponsorBlock notice shows and "Got it" dismisses it. (The notice no longer mentions
      engagement tracking — that was removed.)
- [ ] Walk the relevant parts of [`SMOKE_TEST.md`](SMOKE_TEST.md) on the build you'll
      upload.

## 🟢 Build, fill, and submit

- [ ] `npm run package` → produces `web-store/tldw-<version>.zip` (manifest at root)
- [ ] (Optional) bump `package.json` to `1.0.0` first — `0.1.x` reads as beta
- [ ] In the dashboard, paste from [`STORE_SUBMISSION.md`](STORE_SUBMISSION.md):
  - [ ] Name, short description (114/132), detailed description, category (Productivity), language
  - [ ] Upload the 128×128 icon (have it), screenshots, promo tile
  - [ ] Privacy policy URL: `https://github.com/n8watkins/tl-dw/blob/master/PRIVACY.md`
  - [ ] Single-purpose statement + all 12 permission justifications
  - [ ] Data-use categories + the three certifications
- [ ] **Distribution** tab → set visibility **Public** (or **Unlisted** for a soft launch)
- [ ] **Submit for review**

## ⏳ After submitting

- Expect a **manual review** (a few days up to ~2 weeks for a first submission with
  broad host permissions + the transcript `fetch` wrapper). Pre-written answers to
  the two questions a reviewer is most likely to ask are in
  [`STORE_SUBMISSION.md` §6](STORE_SUBMISSION.md).
- Each future update needs a version higher than the last published one, then another
  (usually faster) review.

## 🔵 Optional polish (not required to publish)

- [ ] Neutralize the third-party brand marks (Claude/OpenAI/etc.) — now inline SVGs in
      `src/lib/DestinationIcon.tsx`; lowers a small IP-complaint risk on a public
      listing; swap to neutral labeled glyphs.
- [ ] Decide on the `1.0.0` version bump for the public launch (current: `0.1.173`).
