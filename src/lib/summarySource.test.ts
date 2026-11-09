import { describe, expect, it } from "vitest";
import { cachedSourceLabel } from "./summarySource";

describe("cachedSourceLabel", () => {
  it("names the profile a saved summary was made with", () => {
    expect(cachedSourceLabel("Quick")).toBe("cached · Quick");
  });
});
