import { describe, expect, it } from "vitest";
import pkg from "../package.json";
import gitignore from "../.gitignore?raw";
import eslintConfig from "../eslint.config.js?raw";
import e2eSpec from "../tests/e2e/extension.spec.ts?raw";

// dist/ is the production build the README says to load unpacked. The e2e
// build (a 250 ms Gemini timeout) must never overwrite it.
describe("build outputs", () => {
  it("the e2e suite builds into dist-e2e/, not dist/", () => {
    expect(pkg.scripts["test:e2e"]).toMatch(/vite build --outDir dist-e2e(\s|$)/);
    expect(e2eSpec).toContain('path.resolve("dist-e2e")');
  });

  it("dist-e2e/ is ignored by git and lint", () => {
    expect(gitignore.split("\n")).toContain("dist-e2e/");
    expect(eslintConfig).toContain('"dist-e2e/**"');
  });
});
