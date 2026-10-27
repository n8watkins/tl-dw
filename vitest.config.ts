import { defineConfig } from "vitest/config";

// Standalone config so tests don't load vite.config.ts (and its crxjs build
// plugin). The helpers under test are pure, so the node environment is enough.
// Run every test in UTC, as CI does, so date fixtures can't pass locally and
// fail on the runner (or the reverse). Workers inherit this from the config.
process.env.TZ = "UTC";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
