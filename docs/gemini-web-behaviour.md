# Gemini web app behaviour with YouTube links

What gemini.google.com does with a YouTube link, signed out and signed in, and what that means for TL;DW's no-key mode (the Gemini tab flow).
Tested live on 2026-11-02 by the owner's agent, with the owner's approval to use their Google account.
For how the code acts on this (`signedInPrompt`, `geminiSignedIn()`, the summary labels), see the 1.1.1 notes in [HANDOFF.md](HANDOFF.md); this page is the evidence behind them.

## Setup

- Signed in: Windows Google Chrome 156, a dedicated test profile signed in to the owner's Google account, Gemini free tier with the model picker on "Gemini Auto".
- Signed out: a fresh headless Chromium profile with no cookies.
- Ground truth: each video's real captions, downloaded with yt-dlp.
- All audio muted (`--mute-audio`, muted tabs, every video element muted and paused).

## Signed out vs signed in: direct prompts

Each video got one chat with three turns:

1. `Summarize this video: <url>`
2. `Did you watch the video itself or read about it? What specific moment happens at 1:00?`
3. `Give the first 30 seconds of the transcript`

| Video | Signed in | Signed out |
| --- | --- | --- |
| `dQw4w9WgXcQ` Rick Astley, 3:33, captions | Timestamped summary. The 1:00 moment is right (end of the first chorus into "We've known each other for so long"). The first 30 s of lyrics are right, with timestamps. | Generic summary; says it "read about it". The 1:00 moment is wrong ("Inside we both know..."). Lyrics come from a Google lyrics card. |
| `L_Guz73e6fw` Lex Fridman #367, 2h24m, captions | Specific summary. The 1:00 moment is right (Lex's intro naming GPT-4, ChatGPT, DALL-E and Codex). The first 30 s is the real transcript, word for word. Says it used "the YouTube tool". | Summary built from web pages (cites Auphonic). The 1:00 moment is vague. The first 30 s is partly invented: it puts Lex's intro first, but the video opens with Sam Altman. |
| `hY7m5jjJ9mM` cat compilation, no captions | Metadata only (title, channel, view count) plus generic cat tropes. Says it can't tell what happens at 1:00 and that there is no transcript. | The same: metadata and search results, and an honest "can't". |
| `6W9YeiX80i0` 12 views, 1 day old, auto captions | Detailed, correct summary. The 1:00 moment is right. The first 30 s is word for word. Says it "analyzed the video's transcript and metadata directly using the video tool". | Fails: "I am unable to directly access or play YouTube links", and nothing in its search index. |

### What works and what doesn't

- Signed in, Gemini has a YouTube tool that reads a public video's captions and metadata from its link.
  It works for long videos and for brand-new videos nobody has written about.
- Signed in, it does not watch the frames.
  For a video without captions it falls back to metadata, like signed out.
  One answer claimed "multimodal video processing" and described a visual detail at 1:00 that could not be checked; don't rely on such claims.
- Signed out, there is no YouTube tool.
  Gemini answers from web search, so a popular video gets a plausible summary with partly wrong specifics, and an obscure video gets nothing.
- The answer shows no "YouTube" app chip.
  The only visible signs are YouTube video cards under some answers, and what Gemini says when asked.

## TL;DW end to end, signed in, no API key

TL;DW 1.1.2, production build, loaded unpacked into the signed-in test profile with no key.
Each run cleared TL;DW's summary cache, opened the video in a muted tab and clicked the TL;DW button.
The Gemini tab opened in the background and stayed hidden for the whole run (the Chrome window was minimized), and no debugger was attached to it.
The owner's own synced extensions were also enabled (vidIQ, Unhook, other YouTube summarizers and so on), because Google Chrome 156 ignores `--load-extension`, and `--disable-extensions-except` then blocks an unpacked TL;DW too.

| Case | Path TL;DW took | Result | Time from click | Panel label | Label accurate? |
| --- | --- | --- | --- | --- | --- |
| `dQw4w9WgXcQ` control | Transcript read on the page, sent in the prompt | 3/3 back in the panel | 10.1 to 10.2 s | none ("Read back from the Gemini tab" in the menu) | Yes |
| `L_Guz73e6fw` long video | TL;DW couldn't read the transcript (3/3), so the signed-in link prompt | 3/3 back in the panel | 20.2 to 20.6 s | "Gemini read the video's transcript through YouTube" | Yes: the details match the real conversation (exponential progress, compression, RLHF, building in public, alignment ahead of capability) |
| `hY7m5jjJ9mM` no transcript | Link prompt, public info only | 3/3 back in the panel | 10.1 to 10.3 s | "No transcript, so Gemini summarized from public info about this video, not the video itself." | Yes: signed-in Gemini doesn't watch frames either |

Quality against the real videos:

- Rick Astley: correct and specific to the lyrics in all three runs.
- Lex Fridman: correct themes in all three runs, phrased differently each time; no invented specifics.
- Cat compilation: generic ("cats miss jumps, react to objects"), which is all public info can give; it says the details are uncertain.

### Bugs found on the way

- **1.1.1, fixed in 1.1.2 (#24):** signed in, every no-key send waited the full 3 minutes and then showed "Couldn't get the summary back in time".
  Gemini's sidebar lists recent chats, each with a "More options for <chat title>" button, and the owner had a chat whose title contains "Stop".
  The stop-button selector `button[aria-label*="Stop" i]` matched it, so TL;DW thought Gemini was still generating.
  Signed-out tests never saw it, because a signed-out page has no chat history.
- **1.1.2, fixed in 1.1.3 (#27):** an answer that arrived after the panel had given up was still cached.
  In the 1.1.1 runs, the Gemini tab's 3-minute fallback sent the raw answer just after the panel timed out; the worker cached it, and the next visit served it from the cache as a broken summary (the whole `---TLDW---` block as the summary line, "Gemini said" in the details).
  Fallback answers (no TL;DW block parsed) and answers for a request the panel has already abandoned should not be cached.
- **1.1.2, fixed in 1.1.3 (#27):** TL;DW failed to read the Lex Fridman transcript in 4 of 5 signed-in runs, even signed in.
  Signed in this no longer hurts the summary, because the link path recovers it, but signed out the same video gets only public info.

## TL;DW 1.1.3, signed in (2026-11-02)

Same setup as above: production build loaded unpacked, no key, cache cleared before each run, Gemini tab in the background of a minimized window, the owner's synced extensions enabled.
1.1.3 fetches YouTube's `get_panel` transcript itself and no longer caches unparsed or late answers.

| Case | Path TL;DW took | Result | Time from click | Panel label | Label accurate? |
| --- | --- | --- | --- | --- | --- |
| `dQw4w9WgXcQ` control | Transcript read, sent in the prompt | 3/3 | 10.1 s | none | Yes |
| `L_Guz73e6fw` Lex Fridman #367, 2h24m | Transcript read (3/3), so the long-video handling applied: notice "This video is long", then the signed-in link prompt | 3/3 | 10.1 to 12.6 s | "Gemini read the video's transcript through YouTube" | Yes: the details match the conversation (GPT-4 as early computing, compression, RLHF, building in public, alignment ahead of capability) |
| `aircAruvnKk` 3Blue1Brown, chaptered | Transcript read (3/3), sent in the prompt | 3/3 | 10.1 to 12.6 s | none | Yes: specific to the video (weighted sums plus bias, sigmoid, the 784-16-16-10 network, matrix-vector form) |
| `hY7m5jjJ9mM` no captions | Link prompt, public info only | 3/3 | 10.1 s | "No transcript, so Gemini summarized from public info about this video, not the video itself." | Yes |

Times are polled every 2.5 s, so they are accurate to about that.

Unparsed answers are no longer cached.
With the test profile's prompt changed so that Gemini answered without a `---TLDW---` block, the panel showed the raw answer (17.6 s) and the cache stayed empty.
A second click on the same video, without clearing the cache, went back to Gemini instead of serving the broken answer.
A late answer (one that arrives after the panel's 3-minute timeout) could not be produced live; the E2E suite covers it with a shortened timeout.

## Implications for no-key mode

- Signed in, the Gemini tab is a real transcript reader: sending the link of a captioned video gives a summary as good as sending the transcript, for videos of any length.
  The link prompt is the right choice for long videos and for captioned videos whose transcript TL;DW can't read.
- Signed out, a link only gets web search; send the transcript (or as much of it as fits) whenever there is one, and label link-only summaries as public info.
- With no captions, neither signed in nor signed out Gemini web watches the video; only the Gemini API with video input does.
  "Watched by Gemini" belongs only on the API video path, and the no-key label for these videos is the same signed in or out.
- Selectors for "Gemini is still generating" must be scoped to the prompt box and the answer, never page-wide, because the signed-in page carries user-written text (chat titles) in its button labels.
- Test the Gemini tab flow signed in as well as signed out: chat history, the account button and the YouTube tool only exist signed in.
