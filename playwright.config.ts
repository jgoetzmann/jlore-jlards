import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a real Chromium. `npm run e2e`.
 *
 * The dev server carries the relay middleware, so a two-browser multiplayer
 * test talks over the same handler the Vercel function runs. No Upstash needed
 * — the middleware falls back to an in-process store when the env vars are
 * absent, which is what makes this runnable in CI.
 *
 * Not parallel: the two-browser spec drives a shared room through one relay,
 * and the game is turn-based, so interleaving specs would fight over turn order.
 *
 * E2E_PORT moves the dev server off 5199, so two checkouts can run their
 * suites side by side without --strictPort failing one of them.
 */
const PORT = Number(process.env['E2E_PORT'] ?? 5199);

export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: `npx vite --port ${PORT} --strictPort`,
    url: `http://localhost:${PORT}`,
    // Always start our own. Reusing a stray dev server means testing whatever
    // tree that server was launched from — which happened: a leftover server
    // from another checkout served the SPA fallback for every /art/ request, so
    // the suite passed 14/14 against the wrong code with no art on disk.
    reuseExistingServer: false,
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
