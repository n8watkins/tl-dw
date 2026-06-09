# Lessons Learned — Building Chrome Extensions

A running, opinionated log of things this project taught us the hard way, so the
next extension doesn't relearn them. Curated by Nathan; suggestions added by
Claude as we go. Each lesson is a real situation we hit in TL;DW, not generic
advice — file/function references point at where it bites.

---

## 1. Don't re-inject your UI on every SPA navigation

**The problem (this one bit us repeatedly).** YouTube is a single-page app: it
rewrites the page on navigation *without* a full reload, and `yt-navigate-finish`
does **not** fire for every navigation type (Shorts, back/forward, suggested-video
clicks). If your injection runs on a timer/observer and isn't idempotent, you
re-insert your panel again and again — stacking duplicates, leaking listeners,
flickering, and quietly tanking performance.

**What to do:**
- Give every injected node a **stable `id`** and remove any existing instance
  before inserting it again (`document.getElementById("tldw-summary")?.remove()`
  then prepend). One mount = one node, always.
- Keep a single source of truth for "is my UI mounted, and for which video?"
  Key it to the current video id; bail early if nothing changed.
- Funnel *all* navigation triggers (immediate load + `yt-navigate-finish` +
  a `MutationObserver` fallback) through **one** idempotent mount function.
  Layered triggers are fine; multiple un-guarded mount paths are not.
- **Debounce** the navigation handler — SPA route changes can fire several
  events in a burst.

## 2. Reach into the page's MAIN world to read its internals

Content scripts run in an **isolated world**: they share the DOM but not the
page's JS objects, so you can't see YouTube's own `window.fetch`, variables, or
events. To capture YouTube's transcript/caption network responses we inject a
script into the **MAIN world** at `document_start` and wrap `window.fetch`
before the page uses it (`youtube-intercept.ts`).

- MAIN-world scripts have **no `chrome.*` APIs** — hand data back to your
  isolated content script via `window.postMessage` and validate a private marker
  (`data.__tldw === true`) so you don't ingest other code's messages.
- **Never let instrumentation throw.** Wrapping the page's `fetch` means a bug in
  your wrapper can break the whole site. Wrap everything in `try/catch` and always
  return the original promise.

## 3. Read the data source, not the rendered markup

Scraping rendered DOM is the most brittle thing you can do. YouTube's transcript
panel is shadow-DOM, list-virtualized, and gets mutated by *other* extensions
(vidIQ, etc.). Reading the intercepted `get_transcript` / `timedtext` **JSON**
instead is independent of all of that. Prefer the network/data layer over the
view layer whenever the data exists there.

## 4. When you must scrape, layer your selectors and surface failures

Sometimes there's no data layer and you have to scrape (e.g. reading an AI's
answer out of ChatGPT/Claude/Gemini, `inject.ts`).

- Order selectors **specific → generic**, and end with **structural fallbacks**
  (any visible `contenteditable`, any enabled submit button) so one renamed
  `data-testid` doesn't take the whole integration down.
- **Make failures visible.** We record a `DeliveryStatus` so the popup can tell
  the user "couldn't auto-fill ChatGPT" instead of failing silently. A selector
  that rotted is a *known* failure mode — instrument for it.

## 5. Detect completion by DOM state, not by sleeping

Background tabs are **throttled**: Chrome slows timers in unfocused tabs, so tight
polling loops drift. Detect "the AI finished generating" by watching DOM state
(the stop/▢ button appearing then disappearing, `inject.ts:waitForResponseAndSend`)
rather than `sleep(fixedMs)`. Use generous deadlines and small settle delays.

## 6. Leave the page exactly as you found it

To extract the transcript we sometimes have to expand the description ("…more")
and open the transcript panel. If you open/expand something, **track that *you*
did it and undo it afterward** (collapse description, close panel). Otherwise the
page visibly jumps — which users read as a mysterious "refresh." Only restore what
you opened; never touch state the user set themselves.

## 7. Respect `chrome.storage` quota and shape

`chrome.storage.local` is ~10 MB. Transcripts are tens to hundreds of KB; storing
one per history entry bloats you toward the cap fast. We store a **transcript-free**
prompt in history and keep the heavy transcript ephemeral. Rule of thumb: persist
the *minimum* durable shape; keep big blobs in memory or `storage.session`.

## 8. Assume the service worker is asleep

MV3 service workers are killed aggressively. Any `chrome.runtime.sendMessage` /
`chrome.tabs.sendMessage` can reject because the other side is gone mid-flight.
Wrap them in `try/catch` with a "best effort" comment, and never build a flow that
*requires* the worker to have been alive continuously.

## 9. State goes stale after every `await`

In an SPA, the user can navigate during any async hop. After awaiting, **re-check**
your assumptions before mutating the DOM: re-resolve the host element, and confirm
`currentVideoId()` is still the video you started with (`if (currentVideoId() !== vid) return;`).
A summary that lands on the wrong video is worse than no summary.

## 10. One owner per piece of UI; track its "kind"

When several injected surfaces can occupy the same spot (idle panel vs loading
skeleton vs final summary vs a standalone rating bar), give the panel a **`kind`**
and enforce **mutual exclusion** — the summary "owns" the rating row, so the
standalone bar removes itself when the summary is present. Two surfaces silently
rendering the same control is a classic source of "why is this showing twice?"

## 11. Isolate your styles from the host page (and vice-versa)

The host page's CSS will fight your injected UI and yours can leak into theirs.
Inline styles (or a shadow root) keep you insulated. A fixed, shared geometry for
repeated elements (e.g. a single `pillGeom` for every pill-shaped control) keeps
injected widgets visually consistent regardless of their text content.

## 12. Decouple capability from configuration

A subtle architecture smell we hit: the on-page widget injection was wired so it
*only* ran when Direct API was enabled, even though the underlying
scrape-and-inject plumbing was independent of it. Keep "can we show UI here" and
"which backend is configured" as **separate** decisions, or you'll gate features
behind unrelated settings without realizing it.

---

### How to add to this file

Add a numbered lesson with: the concrete situation, *why* it bit us, and the rule
to follow next time. Point at the file/function where it lives. Keep it specific —
the value is in the war stories, not the platitudes.
