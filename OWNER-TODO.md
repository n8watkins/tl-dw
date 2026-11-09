# Owner to-do

Things only the owner can do for TL;DW: keys, accounts, store listings and tests in the owner's own browser.
Agents keep this list current; tick an item by changing `[ ]` to `[x]` and adding the date.
No secrets go in this file: keys live in pass-env, and this file names only the entries.
The cross-project list of keys to rotate is `SECURITY-TODO.md` in the private [secret-handling-review](https://github.com/n8watkins/secret-handling-review/blob/main/SECURITY-TODO.md) repo.

Last checked: 2026-11-09 (version 1.2.1).

## 1. Test the real Gemini API

- [ ] The Gemini key is in pass-env and `smoke:gemini` passes.

**What.**
Store your Gemini API key in pass-env and run the live smoke test.

**Steps.**

1. Finish the pass-env one-time setup first (see `OWNER-TODO.md` in [pass-env](https://github.com/n8watkins/pass-env/blob/main/OWNER-TODO.md)).
2. In your own terminal, store the key (paste it at the hidden prompt):

   ```sh
   pass-env set shared/GEMINI_API_KEY
   ```

3. From the repo folder:

   ```sh
   pass-env run -- npm run smoke:gemini
   ```

4. Every line should start with `ok`; tell Claude about any `FAIL` line.
5. Optional: go through [docs/SMOKE_TEST.md](docs/SMOKE_TEST.md) with the key in the options page.

**Why.**
Version 1.1.0 defaults to `gemini-3.5-flash-lite`, falls back to `gemini-3.1-flash-lite` after a 429, and sends videos without a transcript as video input.
All three were verified only against mocked responses, because no key was available on 2026-11-02.

**Unblocks.**
Confidence in the Direct API path; the store submission (item 3) does not depend on it, because the no-key path and the example summary need no key.

## 2. Check the no-key flows in your signed-in Chrome

- [ ] Long videos and chaptered videos work without a key in signed-in Chrome.

**What.**
With no Gemini key set, summarize a few videos in your normal, signed-in Chrome.

**Steps.**

1. Load the current build (`dist/`, or the Windows folder from item 4) in Chrome, signed in to Google and YouTube, with Direct API off.
2. Summarize a long video (over an hour): the transcript is too long for the Gemini tab, so TL;DW should send the link and Gemini should watch the video.
3. Summarize the chaptered 3Blue1Brown videos `aircAruvnKk` and `IHZwWFHWa-w`, and note whether TL;DW finds a transcript.
4. Tell Claude what you saw (a screenshot is enough).

**Why.**
Signed-out automation gets no transcript for most chaptered videos (open problems 2 and 6 in [docs/HANDOFF.md](docs/HANDOFF.md)); only a signed-in browser shows whether real users hit it.
An agent cannot drive your signed-in Chrome profile.

**Unblocks.**
The decision whether the transcript reader needs more work before the store launch.

## 3. Publish to the Chrome Web Store (Unlisted)

- [ ] TL;DW 1.2.1 is submitted with Unlisted visibility.

**What.**
Register as a Chrome Web Store developer and submit the extension.

**Steps.**

1. Pick the Google account that will own the listing; its email can never be changed later.
2. Turn on 2-Step Verification on that account.
3. Open https://chrome.google.com/webstore/devconsole, accept the developer agreement and pay the one-time $5 fee.
4. In account settings, set the publisher name, then add and verify the contact email.
5. Declare non-trader (a free personal project) or trader (published as a business; the store then shows your business contact details to EU users).
6. Add a new item and upload `web-store/tldw-1.2.1.zip` (ask Claude to rebuild it from the `v1.2.1` tag if it is missing).
7. Paste every field from [docs/STORE_SUBMISSION.md](docs/STORE_SUBMISSION.md) and upload the images in `store-assets/`.
8. Privacy policy URL: https://n8builds.dev/privacy/tldw once it is live, else https://github.com/n8watkins/tl-dw/blob/master/PRIVACY.md
9. Set visibility to **Unlisted** and submit.
10. Send Claude the store link once it is approved, or the rejection email if it is rejected.

**Why.**
The publisher account, the fee and the submission need your Google account.

**Unblocks.**
Installs for other people, the unlisted test cohort, and later a Public listing.

## 4. Optional: copy builds to Windows automatically

- [ ] `TLDW_COPY_DIR` is set in your shell profile.

**What.**
Let `npm run build` copy `dist/` to the folder Chrome loads from on Windows.

**Steps.**

1. Add this line to `~/.zshrc`:

   ```sh
   export TLDW_COPY_DIR=/mnt/c/Users/natha/Projects/Tools/tldw
   ```

2. Open a new terminal.

**Why.**
Without it, `npm run build` leaves the build in `dist/` and you copy it yourself.

**Unblocks.**
One-step local updates of the unpacked extension in Windows Chrome.
