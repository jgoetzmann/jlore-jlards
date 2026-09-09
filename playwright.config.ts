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
 */
export default defineConfig({
  testDir: './e2e',
  timeout: 120_000,
  expect: { timeout: 15_000 },
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:5199',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'off',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: {
    command: 'npx vite --port 5199 --strictPort',
    url: 'http://localhost:5199',
    reuseExistingServer: !process.env['CI'],
    timeout: 120_000,
    stdout: 'ignore',
    stderr: 'pipe',
  },
});
