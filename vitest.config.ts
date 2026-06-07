import { defineConfig } from "vitest/config";

// Standalone config so tests don't load vite.config.ts (and its crxjs build
// plugin). The helpers under test are pure, so the node environment is enough.
export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
