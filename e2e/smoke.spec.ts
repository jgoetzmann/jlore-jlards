/**
 * Production smoke test — is the deployed site actually playable?
 *
 *   npm run smoke                       # against the default deployment
 *   SMOKE_URL=https://… npm run smoke   # against a preview
 *
 * Excluded from `npm run e2e` and therefore from CI: it talks to a live
 * deployment, so a failure here means the deployment is unhealthy, not that the
 * commit is bad.
 *
 * The multiplayer case is the one worth running. A deployment missing its
 * Upstash credentials still serves the app, still returns 200 from the relay,
 * and still passes a casual curl — because sequential requests reuse one warm
 * serverless instance. Two real players do not: their `hello` and the host's
 * poll land on different instances with different memory, the host never sees
 * the join, and the second player sits on "Joining…" forever. That is invisible
 * from the outside and this is what catches it.
 */

import { test, expect } from '@playwright/test';

const URL_UNDER_TEST = process.env['SMOKE_URL'] ?? 'https://jlore-jlards.vercel.app';

test.describe('production smoke', () => {
  test.use({ baseURL: URL_UNDER_TEST });

  test('the app loads and deals a hand', async ({ page }) => {
    await page.goto(`${URL_UNDER_TEST}/#hotseat:2`);
    await expect(page.getByTestId('table')).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId('hand').getByTestId('card')).not.toHaveCount(0);
  });

  test('card art is served, not falling back to gradients', async ({ page }) => {
    const bad: string[] = [];
    page.on('response', (r) => {
      const u = r.url();
      if (!u.includes('/art/')) return;
      const type = r.headers()['content-type'] ?? '';
      if (r.status() >= 400 || !type.startsWith('image/')) bad.push(`${r.status()} ${type} ${u}`);
    });
    await page.goto(`${URL_UNDER_TEST}/#hotseat:2`);
    await expect(page.getByTestId('table')).toBeVisible({ timeout: 45_000 });
    await page.waitForLoadState('networkidle').catch(() => undefined);
    expect(bad, `art responses were not images: ${bad.join(' | ')}`).toHaveLength(0);
  });

  test('the relay is backed by Redis, not per-instance memory', async ({ request }) => {
    const res = await request.post(`${URL_UNDER_TEST}/api/room/SMOKECHK`, {
      data: { from: 'p1', kind: 'hello', payload: {} },
    });
    expect(res.status(), 'relay should answer').toBe(200);
    // Set by the function itself. `memory` means the Upstash credentials are
    // missing, which serves fine for one caller and breaks two.
    expect(
      res.headers()['x-jlore-store'],
      'deployment is on the in-memory fallback — set UPSTASH_REDIS_REST_URL and _TOKEN',
    ).toBe('redis');
  });

  test('a second browser can actually join a room', async ({ browser }) => {
    test.setTimeout(180_000);
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await host.goto(`${URL_UNDER_TEST}/`);
      await expect(host.getByTestId('create-room')).toBeVisible({ timeout: 45_000 });
      await host.getByTestId('create-room').click();
      await expect.poll(async () => new URL(host.url()).hash).not.toBe('');
      const code = new URL(host.url()).hash.replace(/^#/, '');
      await expect(host.getByTestId('lobby')).toBeVisible({ timeout: 45_000 });

      // The lobby roster is the sharpest reading of this deployment there is:
      // the guest only enters it if the host's poll actually saw the guest's
      // `hello`, which is the exact round trip a per-instance memory store
      // breaks. It used to take a 60s timeout on a spinner to find that out.
      await guest.goto(`${URL_UNDER_TEST}/#${code}`);
      await expect(
        host.getByTestId('lobby-player'),
        'the host never saw the joiner arrive — the hello and the poll landed on different instances, which is what a per-instance memory store does',
      ).toHaveCount(2, { timeout: 60_000 });

      await host.getByTestId('lobby-start').click();
      await expect(host.getByTestId('table')).toBeVisible({ timeout: 45_000 });
      await expect(
        guest.getByTestId('table'),
        'the joiner was in the lobby but never got a table',
      ).toBeVisible({ timeout: 60_000 });

      await expect
        .poll(async () => guest.getByTestId('turn-number').textContent(), { timeout: 45_000 })
        .toBe(await host.getByTestId('turn-number').textContent());
    } finally {
      await hostCtx.close().catch(() => undefined);
      await guestCtx.close().catch(() => undefined);
    }
  });
});
