# Decisions

Product decisions that shape TL;DW, newest first.
Each says what was decided, by whom, and why, so later changes can be weighed against it.

## 2026-11-09: Transcript first, and times only when checked

Decided by the owner, Nathan Watkins, after the timestamp study and the link-only experiment (9 Nov 2026).

- TL;DW sends the transcript it read itself first, with the API key and in the no-key Gemini tab alike, as one "[m:ss] text" line per caption.
- A long transcript is never cut to fit: the Gemini tab gets it in several messages and then the request; the API gets notes per part and then one summary of the notes.
  Only a transcript longer than about six hours in the tab is still sent as its start and end, labeled so.
- TL;DW falls back to the video's link only when there is no transcript.
  With a key, Gemini watches the video (in two-hour stretches when it is longer than one request takes).
  Without one, only a signed-in Gemini can read the video's captions from its link, so a signed-out user is asked to sign in instead of getting a guess.
- Key moments are an optional add-on, never what the design is built around.
  A time is shown only when the summary came from a timed transcript TL;DW read itself and the model's quoted words appear in the captions within 15 seconds of it.
  Every other point is a plain highlight with no time, and a summary made from the link never shows times.

Why: in the study, 37 of 37 points cited from a timed transcript landed where the claim is made, while link-only answers got 6 of 18 times right and invented quotes for a video without captions.

## 2026-11-09: Profiles that look different, and no Moment Finder

Decided by the owner.

The built-in profiles are Quick, Research, Learning and Tutorial, each with its own layout on the page: the takeaway and three points; claims with how the video backs each; the key ideas as cards with two questions; numbered steps with what you need first.
Moment Finder is removed: any profile now gets times when they can be checked, and a profile named for moments promised what TL;DW can't always deliver.
Unedited built-ins take the new versions on update, edited ones keep their wording, and Moment Finder's users move to Quick.

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
