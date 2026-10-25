import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Each test file gets its own in-memory database, so files can run in parallel.
  test: { env: { DATABASE_PATH: ':memory:', BOT_TOKEN: '1:test', BOT_MODE: 'off' } },
});
