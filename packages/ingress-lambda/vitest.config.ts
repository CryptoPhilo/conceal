import { defineConfig } from "vitest/config";
import { resolve } from "path";

export default defineConfig({
  resolve: {
    alias: {
      "@shadow/shared": resolve(__dirname, "../shared/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    globals: true,
  },
});
