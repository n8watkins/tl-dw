# Publish to the Chrome Web Store — Checklist

The actionable runway to a submitted listing. Detailed copy, permission
justifications, and data-use answers live in
[`STORE_SUBMISSION.md`](STORE_SUBMISSION.md); this is the "what's left + do these"
tracker.

**Where we are (2026-06-20):** Compliance audit passed — 49/49 requirements clear,
**0 code or policy blockers**. All listing text, permission justifications, the
privacy policy, and the upload package are ready. The only things standing between
you and "Submit" are **two graphics** and the **developer account**.

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

- [ ] **Direct API live-key test** — run one Direct-API summary with a real Gemini
      key to confirm the new `x-goog-api-key` header call still works.
- [ ] **First-run notice** — load the latest build, open the popup once, confirm the
      SponsorBlock/engagement notice shows and "Got it" dismisses it.
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

- [ ] Neutralize the bundled third-party brand logos (Claude/OpenAI/etc.) — lowers a
      small IP-complaint risk on a public listing; swap to neutral labeled glyphs.
- [ ] Decide on the `1.0.0` version bump for the public launch.
