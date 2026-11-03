import { describe, expect, it } from "vitest";
import {
  extractFromGetPanel,
  extractFromGetTranscript,
  extractFromTimedText,
  joinSegments,
  stripSegmentTimeLabels,
  transcriptPanelParams,
} from "./youtubeTranscript";

/** One segment as YouTube's get_panel response shaped it on 2026-11-02. */
function panelSegment(index: number, seconds: number, text: string, videoId = "dQw4w9WgXcQ") {
  const clock = `0:${String(seconds).padStart(2, "0")}`;
  return {
    macroMarkersPanelItemViewModel: {
      item: {
        timelineItemViewModel: {
          timestamp: clock,
          contentItems: [{
            transcriptSegmentViewModel: {
              simpleText: text,
              style: "TIMELINE_VIEW_STYLE_MODERN_INLINE_TIMESTAMPS",
              timestamp: clock,
              timestampA11yLabel: `${seconds} seconds`,
            },
          }],
        },
      },
      index,
      panelId: "PAmodern_transcript_view",
      onTap: {
        innertubeCommand: {
          watchEndpoint: { videoId, continuePlayback: true, startTimeSeconds: seconds },
        },
      },
    },
  };
}

function panelResponse(items: unknown[]) {
  return {
    responseContext: { serviceTrackingParams: [] },
    content: {
      engagementPanelSectionListRenderer: {
        header: { engagementPanelTitleHeaderRenderer: { title: { runs: [{ text: "Transcript" }] } } },
        content: {
          sectionListRenderer: {
            contents: [{ itemSectionRenderer: { contents: items } }],
          },
        },
        identifier: { surface: "ENGAGEMENT_PANEL_SURFACE_WATCH", tag: "PAmodern_transcript_view" },
      },
    },
  };
}

describe("extractFromGetPanel", () => {
  it("reads only the spoken text and the video id, never the time labels", () => {
    const result = extractFromGetPanel(panelResponse([
      panelSegment(0, 1, "[♪♪♪]"),
      panelSegment(1, 18, "♪ We're no strangers to love ♪"),
      panelSegment(2, 27, "♪ A full commitment's what I'm thinking of ♪"),
    ]));
    expect(result).toEqual({
      text: "[♪♪♪] ♪ We're no strangers to love ♪ ♪ A full commitment's what I'm thinking of ♪",
      videoId: "dQw4w9WgXcQ",
    });
    expect(result?.text).not.toMatch(/seconds?|0:18/);
  });

  it("ignores get_panel responses for other panels", () => {
    expect(extractFromGetPanel({ content: { engagementPanelSectionListRenderer: { content: {} } } })).toBeNull();
    expect(extractFromGetPanel(null)).toBeNull();
  });
});

describe("extractFromGetTranscript", () => {
  it("reads classic transcriptSegmentRenderer snippets", () => {
    const body = {
      actions: [{
        segments: [
          { transcriptSegmentRenderer: { snippet: { runs: [{ text: "Hello there, " }, { text: "general" }] } } },
          { transcriptSegmentRenderer: { snippet: { simpleText: "Kenobi, you are a bold one." } } },
        ],
      }],
    };
    expect(extractFromGetTranscript(body)).toBe("Hello there, general Kenobi, you are a bold one.");
  });
});

describe("extractFromTimedText", () => {
  it("reads json3 and XML captions", () => {
    const json3 = JSON.stringify({ events: [{ segs: [{ utf8: "First caption line " }, { utf8: "and the second one" }] }] });
    expect(extractFromTimedText(json3)).toBe("First caption line and the second one");
    const xml = '<transcript><text start="0">Tom &amp; Jerry &#39;run&#39;</text><text start="2">across the whole house &lt;fast&gt;</text></transcript>';
    expect(extractFromTimedText(xml)).toBe("Tom & Jerry 'run' across the whole house <fast>");
  });
});

describe("stripSegmentTimeLabels", () => {
  it("removes the clock and the spoken label the modern panel renders", () => {
    // textContent of a modern segment: clock, a11y label and text, unspaced.
    expect(stripSegmentTimeLabels("0:011 second[♪♪♪]")).toBe("[♪♪♪]");
    expect(stripSegmentTimeLabels("0:1818 seconds♪ We're no strangers to love ♪")).toBe("♪ We're no strangers to love ♪");
    expect(stripSegmentTimeLabels("1 second[♪♪♪]")).toBe("[♪♪♪]");
    expect(stripSegmentTimeLabels("1:051 minute, 5 seconds So here we go")).toBe("So here we go");
    expect(stripSegmentTimeLabels("1:02:031 hour, 2 minutes, 3 seconds The end")).toBe("The end");
  });

  it("keeps classic segments and plain text intact", () => {
    expect(stripSegmentTimeLabels("00:01  The fixture transcript\n explains")).toBe("The fixture transcript explains");
    expect(stripSegmentTimeLabels("Seconds later it was over")).toBe("Seconds later it was over");
  });
});

describe("joinSegments", () => {
  it("joins non-empty segments with single spaces", () => {
    expect(joinSegments([" a ", "", "b\nc"])).toBe("a b c");
    expect(joinSegments(["", " "])).toBeNull();
  });
});

describe("transcriptPanelParams", () => {
  it("matches what YouTube's web client sends for the transcript panel", () => {
    // Captured from youtube.com on 2026-11-02.
    expect(transcriptPanelParams("dQw4w9WgXcQ")).toBe("qgkPCgtkUXc0dzlXZ1hjURgC");
    expect(transcriptPanelParams("aircAruvnKk")).toBe("qgkPCgthaXJjQXJ1dm5LaxgC");
  });
});
