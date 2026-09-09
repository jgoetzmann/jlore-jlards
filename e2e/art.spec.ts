/**
 * Card art actually loads.
 *
 * `artUrl()` builds `/art/<key>.<ext>`. Nothing else in the codebase asserts the
 * extension, and the failure mode is silent: if it ever goes back to `.png`,
 * every one of the 559 images 404s, every card falls back to its initials
 * gradient, and the unit suite stays green because no test touches `artUrl`.
 * The only way to catch that is to load a real match in a real browser and ask
 * the browser whether the bytes arrived.
 */

import { test, expect } from '@playwright/test';

test.describe('card art', () => {
  test('a hand card renders a real image, not the placeholder gradient', async ({ page }) => {
    await page.goto('/#hotseat:2');
    await expect(page.getByTestId('table')).toBeVisible();

    const imgs = page.getByTestId('hand').getByTestId('card').locator('img');
    const count = await imgs.count();
    expect(count, 'hand cards should render <img> elements').toBeGreaterThan(0);

    // naturalWidth is 0 for an image that failed to load. This is the assertion
    // that a 404 cannot pass.
    const first = imgs.first();
    await expect
      .poll(async () => first.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 })
      .toBeGreaterThan(0);

    const src = await first.getAttribute('src');
    expect(src, 'art src should point at the art directory').toContain('/art/');
  });

  test('every art response is actually an image, not an SPA fallback', async ({ page }) => {
    // A 404 is not the only failure. A dev server with no `public/art` answers
    // 200 with the SPA's index.html, and an <img> pointed at HTML fails to
    // decode while every status code looks fine — which is exactly how this
    // went unnoticed once already. Assert the content-type, not just the status.
    const bad: string[] = [];
    page.on('response', (r) => {
      const u = r.url();
      if (!u.includes('/art/')) return;
      const type = r.headers()['content-type'] ?? '';
      if (r.status() >= 400) bad.push(`${r.status()} ${u}`);
      else if (!type.startsWith('image/')) bad.push(`${r.status()} ${type} ${u}`);
    });

    await page.goto('/#hotseat:2');
    await expect(page.getByTestId('table')).toBeVisible();
    // Give the board's images a moment to settle.
    await page.waitForLoadState('networkidle').catch(() => undefined);

    expect(bad, 'art responses were not images: ' + bad.join(' | ')).toHaveLength(0);
  });

  test('shop pile art loads too, not just the hand', async ({ page }) => {
    await page.goto('/#hotseat:2');
    await expect(page.getByTestId('table')).toBeVisible();

    const pileImg = page.getByTestId('shop-draft').getByTestId('card').locator('img').first();
    if ((await pileImg.count()) === 0) {
      test.skip(true, 'no draft pile rendered a card face');
      return;
    }
    await expect
      .poll(async () => pileImg.evaluate((el: HTMLImageElement) => el.naturalWidth), { timeout: 15_000 })
      .toBeGreaterThan(0);
  });
});
