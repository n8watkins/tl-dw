# TL;DW

TL;DW means "Too Long; Didn't Watch." It is a Manifest V3 Chrome extension for sending the current YouTube video to Gemini with a saved prompt profile.

The core flow is simple: open a YouTube watch page or Short, press `Alt+G`, and TL;DW opens Gemini, injects the selected/default prompt, and submits it. The extension saves the prompt and video URL locally when history is enabled. It does not save Gemini responses.

## What It Does

- Detects YouTube watch pages and Shorts from the active Chrome tab.
- Builds a Gemini prompt from an editable prompt profile.
- Opens Gemini and attempts to fill and submit the prompt automatically.
- Falls back to copying the prompt if Gemini's composer cannot be filled.
- Provides built-in profiles for summary, research, learning, tutorial extraction, and moment finding.
- Provides an options page for setup, profiles, history, settings, and project/about information.

## Privacy

- No backend service.
- No analytics.
- No YouTube OAuth.
- No Gemini API key.
- Prompt history stays in Chrome local storage on your machine.
- Gemini responses are not read or stored by the extension.

## Local Setup

Install dependencies:

```bash
npm install
```

Run a local Vite dev server:

```bash
npm run dev
```

Build and copy to the Windows folder Chrome loads from:

```bash
npm run build
```

`npm run build` increments the patch version in `package.json` and `package-lock.json`, builds `dist/`, and copies the built extension to the folder Chrome loads from:

```text
/mnt/c/Users/natha/Projects/Tools/tldw
```

The version bumps on every build so the number in the popup always changes — a quick way to confirm a reload actually picked up the new build. If the build or Windows copy step fails, the package version files are restored to their previous contents. Use `npm run dev` for live iteration without bumping.

After a successful build, open `chrome://extensions` and click Reload on the unpacked TL;DW extension so Chrome picks up the copied files. The popup's version number should match the latest build.

## Chrome Install

1. Open `chrome://extensions`.
2. Enable Developer mode.
3. Click Load unpacked.
4. Select `C:\Users\natha\Projects\Tools\tldw`.
5. Confirm or adjust the shortcut at `chrome://extensions/shortcuts`.

## Current Roadmap

- Add a popup curiosity field for per-search questions.
- Add profile import/export.
- Improve history filtering by profile and date range.
- Explore transcript-aware prompts.
- Add optional BYO-key Gemini API mode if response saving becomes worth the extra surface area.
