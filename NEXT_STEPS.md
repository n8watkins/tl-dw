# TL;DW — Code Review & Next Steps

_Review date: 2026-06-06. Reviewed after shipping the destination system, NotebookLM
automation, auto-pause, the worth-watching verdict gate, and open-search/history in
the popup (v0.1.30)._

---

## What's solid

- **Clean separation of concerns in the destination model** — `mode` (delivery),
  `payload` (content), `canWatch` (transcript needed?). Adding a destination is a
  one-line registry entry plus, if it auto-fills, a `configForHost` block.
- **Transcript capture is robust** — reads the intercepted InnerTube/timedtext
  network data (survives DOM redesigns), with a rendered-panel scrape as fallback.
- **Everything polls until ready** instead of fixed sleeps — timeouts are ceilings,
  not guesses. This came out of the NotebookLM tuning and is the right pattern.
- **Privacy posture intact** — only prompt + URL + timestamp are stored, never the
  model's response.

---

## Fixed in this pass

- **Popup no longer blocks on the transcript scrape.** `send()` was awaiting the full
  `runSummary` round-trip, so the popup sat open spinning for up to ~10s on
  ChatGPT/Claude/Perplexity. Now it fires the `ASK` message and closes immediately;
  the service worker finishes the work independently.

---

## Recommended next (roughly in priority order)

### 1. Decide the fate of the dead clipboard path
Every destination is now `mode: "inject"`, so the entire `clipboard` delivery path is
unreachable:
- `sendViaClipboard()` + the clipboard branch of `askAgain()` in `popup/App.tsx`
- the clipboard branch of `runSummary()` and `copyViaTab()` in `background/index.ts`
- `COPY_TO_CLIPBOARD` handler, `copyTextToClipboard()`, `copyViaExecCommand()` in
  `content/youtube.ts`
- the `"clipboard"` arm of `DestinationMode`

**Either** delete it (smaller surface, less to maintain) **or** keep it as the
declared fallback for a future un-fillable destination and add a code comment saying
so. Right now it reads as live code but can never run. _Note: the content-script
`fallbackToClipboard()` in `inject.ts` is still live and should stay — that's the
auto-fill-failed path, which is different._

### 2. Reuse an open destination tab instead of always opening a new one
We already track open searches per destination in `chrome.storage.session`. Before
`chrome.tabs.create`, check for an existing open tab for that destination and offer to
reuse it (focus + new prompt) rather than piling up Gemini tabs. The plumbing
(`getOpenSearches`) is already there.

### 3. "Summarize up to where I am"
Capture the player's `currentTime` and trim the transcript to that point, so a partial
watch gets a partial summary. The transcript path already has timestamps available in
the intercepted data; this is mostly a slicing + a popup toggle.

### 4. Surface auto-fill / gate failures back to the user
Inject failures only show a toast on the destination page; the badge isn't used for
inject success/failure. Consider a small success badge on hand-off and a clearer
signal when the composer wasn't found, so a silent selector rot is noticeable.

### 5. Roadmap #6 — clickable seek links (the hard one)
Render key-moment timestamps from the summary as links that seek the YouTube player.
Needs: a structured "moments" section in the prompt output, parsing it, and injecting
a clickable overlay on the YouTube page that calls `video.currentTime = …`. Highest
effort, highest novelty. Defer until the above are done.

### 6. Selector resilience review
`configForHost` selectors for ChatGPT/Claude/Perplexity and NotebookLM's dialog
heuristics are inherently brittle. Worth a periodic re-test and possibly a tiny
"last verified" note per site so breakage is easy to localize.

---

## Smaller cleanups

- `worthWatchingMinutes` is typed as `number` but the UI only offers 15/20/30/45/60 —
  fine, just note it's not a union so arbitrary values are storable.
- The primary button reads "Ask NotebookLM" for the NotebookLM destination, which is a
  sources tool, not a chat. Consider a per-destination verb ("Add to NotebookLM").
- `PLAN.md` still frames the product as Gemini-only ("Alt+G", §1–§4). It predates the
  multi-destination work; worth a refresh so it matches reality.
