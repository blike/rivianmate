import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Database integration tests share one disposable database and truncate
    // its tables, so run files one at a time when they're enabled.
    fileParallelism: !process.env.TEST_DATABASE_URL,
  },
});
