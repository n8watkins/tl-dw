# Decisions

Product decisions that shape TL;DW, newest first.
Each says what was decided, by whom, and why, so later changes can be weighed against it.

## 2026-11-09: TL;DW is Gemini-only

Decided by the owner, Nathan Watkins.

TL;DW now summarizes with Google's Gemini only, in two modes:

- Your own Gemini key: summaries come straight from the Gemini API, with no tab.
- No key: TL;DW asks the Gemini web app in a background tab and brings its answer back to the YouTube page.

The ChatGPT, Claude and NotebookLM destinations are gone, with their code paths, their optional host permissions, the `scripting` permission that registered TL;DW's script on those sites, and the "Default destination" setting.

Why:

- Gemini is the best of these at understanding YouTube videos: with a key it can watch a video that has no captions, and it reads long transcripts whole.
- One AI service means one way to read an answer, one set of page selectors to keep working, and simpler copy, settings and privacy disclosures.
- The store listing gets simpler: fewer permissions and justifications, and a clearer single purpose.

What happens to existing users:

- A user whose default destination was ChatGPT, Claude or NotebookLM is moved to Gemini on update, and the popup says so once, naming the site they had picked.
- History and Stats still name the site an older summary went to.

This does not change the transcript strategy (decided the same day): TL;DW sends the transcript first, and falls back to the video's link only when there is no transcript.
