/**
 * SB-63: the table fits the screen, and nothing on it is invisibly unclickable.
 *
 * Both earlier fixes for the below-the-fold hand were reverted for the same
 * reason: they produced a layout that looked *better* while a Buy button sat
 * under something that took the pointer (bb23919 clipped piles under IN PLAY;
 * 0745fb7's sticky hand covered the board). Neither shows up in a screenshot or
 * the unit suite. This spec is the check that would have caught both:
 *
 *   - at 1280x720 and 1366x768 the page itself never scrolls;
 *   - the hand, every hand card, the Money/Buys/Actions stats and End turn are
 *     inside the viewport and hit-testable with no page scroll;
 *   - every pile's Buy control is hit-testable (`document.elementFromPoint` at
 *     its centre is the control or inside it) once the board region is
 *     scrolled to it — at the start of the turn, after the Coppers are played
 *     (when IN PLAY has grown, which is when both old attempts broke), and
 *     after a buy;
 *   - the rigid rows leave the board region room for a whole shop row, with
 *     the budget taken from measured boxes rather than hard-coded pixels.
 */

import { test, expect, type Page } from '@playwright/test';

const HOTSEAT = '/#hotseat:2';

async function focusSeatToMove(page: Page): Promise<void> {
  const toMove = page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]');
  if ((await toMove.count()) > 0) await toMove.first().click();
}

/** Answer any prompt that is blocking play. */
async function clearPrompt(page: Page): Promise<boolean> {
  if ((await page.getByTestId('prompt').count()) === 0) return false;
  const dflt = page.getByTestId('prompt-default');
  if ((await dflt.count()) > 0 && (await dflt.first().isEnabled())) {
    await dflt.first().click();
    return true;
  }
  const option = page.getByTestId('prompt-option');
  if ((await option.count()) > 0) await option.first().click();
  const confirm = page.getByTestId('prompt-confirm');
  if ((await confirm.count()) > 0 && (await confirm.first().isEnabled())) {
    await confirm.first().click();
    return true;
  }
  const skip = page.getByTestId('prompt-skip');
  if ((await skip.count()) > 0) {
    await skip.first().click();
    return true;
  }
  return false;
}

async function pageScroll(page: Page): Promise<{ sh: number; sw: number; ih: number; iw: number }> {
  return page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return { sh: el.scrollHeight, sw: el.scrollWidth, ih: innerHeight, iw: innerWidth };
  });
}

/**
 * For every element matching `selector`: is it fully inside the viewport, and
 * does a hit test at its centre land on it? Returns the failures.
 */
async function notOnScreen(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const bad: string[] = [];
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
    if (els.length === 0) bad.push(`${sel}: none rendered`);
    for (const el of els) {
      const r = el.getBoundingClientRect();
      const label = `${sel}${el.dataset['iid'] ? `[${el.dataset['iid']}]` : ''}`;
      if (r.top < 0 || r.left < 0 || r.bottom > innerHeight + 0.5 || r.right > innerWidth + 0.5) {
        bad.push(`${label} outside the viewport: ${Math.round(r.left)},${Math.round(r.top)}–${Math.round(r.right)},${Math.round(r.bottom)}`);
        continue;
      }
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) {
        bad.push(`${label} covered by ${hit ? `${hit.tagName}.${String(hit.className)}` : 'nothing'}`);
      }
    }
    return bad;
  }, selector);
}

/**
 * Scroll the board region to each pile's Buy and hit-test its centre. Also
 * checks the centre is inside the board region's visible box — a button
 * outside it would be clipped even if nothing else claimed the point.
 */
async function unreachableBuys(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    const region = document.querySelector<HTMLElement>('[data-testid="board-region"]');
    if (!region) return ['no board region'];
    const piles = Array.from(document.querySelectorAll<HTMLElement>('[data-testid="pile"]'));
    if (piles.length === 0) return ['no piles'];
    for (const pile of piles) {
      const id = pile.dataset['pileId'] ?? '?';
      const buy = pile.querySelector<HTMLElement>('[data-testid="buy"]');
      if (!buy) {
        bad.push(`${id}: no Buy`);
        continue;
      }
      buy.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = buy.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const rr = region.getBoundingClientRect();
      if (y < rr.top || y > rr.bottom || x < rr.left || x > rr.right) {
        bad.push(`${id}: Buy centre ${Math.round(x)},${Math.round(y)} is outside the board region`);
        continue;
      }
      const hit = document.elementFromPoint(x, y);
      if (!hit || !(hit === buy || buy.contains(hit))) {
        bad.push(`${id}: Buy at ${Math.round(x)},${Math.round(y)} is covered by ${hit ? `${hit.tagName}.${String(hit.className)}` : 'nothing'}`);
      }
    }
    region.scrollTop = 0;
    return bad;
  });
}

/**
 * The row budget, from measured boxes: the four rows tile the viewport, and
 * what the rigid rows leave for the board region holds the tallest shop tile
 * plus its shop's heading. So any pile can be scrolled fully into view.
 */
async function checkBudget(page: Page, height: number): Promise<void> {
  const box = async (id: string) => {
    const b = await page.getByTestId(id).boundingBox();
    expect(b, `${id} has a box`).not.toBeNull();
    return b!;
  };
  const top = await box('topbar');
  const seats = await box('opponents');
  const board = await box('board-region');
  const dock = await box('dock');

  const tallestPile = await page.evaluate(() =>
    Math.max(...Array.from(document.querySelectorAll('[data-testid="pile"]')).map((p) => p.getBoundingClientRect().height)),
  );
  const shopHead = await page.evaluate(() => {
    const t = document.querySelector('.shop-title');
    return t ? t.getBoundingClientRect().height : 0;
  });

  // The four rows tile the screen: nothing below the dock, no overlap between rows.
  expect(Math.abs(top.height + seats.height + board.height + dock.height - height)).toBeLessThanOrEqual(3);
  expect(dock.y + dock.height).toBeLessThanOrEqual(height + 1);
  expect(board.y).toBeGreaterThanOrEqual(seats.y + seats.height - 1);
  expect(dock.y).toBeGreaterThanOrEqual(board.y + board.height - 1);

  const rigid = top.height + seats.height + dock.height;
  expect(
    height - rigid,
    `rigid rows (${Math.round(rigid)}px) must leave room for a pile (${Math.round(tallestPile)}px) and its heading`,
  ).toBeGreaterThanOrEqual(tallestPile + shopHead);
}

for (const [width, height] of [
  [1280, 720],
  [1366, 768],
] as const) {
  test.describe(`SB-63 at ${width}x${height}`, () => {
    test.use({ viewport: { width, height } });

    test('the page never scrolls; hand, stats and End turn are on screen and clickable', async ({ page }) => {
      await page.goto(HOTSEAT);
      await expect(page.getByTestId('table')).toBeVisible();
      await focusSeatToMove(page);
      await expect(page.getByTestId('hand').getByTestId('card').first()).toBeVisible();

      const s = await pageScroll(page);
      expect(s.sh, 'page scroll height').toBeLessThanOrEqual(s.ih + 1);
      expect(s.sw, 'page scroll width').toBeLessThanOrEqual(s.iw + 1);

      for (const sel of [
        '[data-testid="hand"]',
        '[data-testid="hand"] [data-testid="card"]',
        '[data-testid="end-turn"]',
        '[data-testid="stat-money-value"]',
        '[data-testid="stat-buys-value"]',
        '[data-testid="stat-actions-value"]',
      ]) {
        const bad = await notOnScreen(page, sel);
        expect(bad, bad.join('\n')).toHaveLength(0);
      }

      await checkBudget(page, height);
    });

    test('every Buy is hit-testable after scrolling the board — before, after the Coppers, after a buy', async ({ page }) => {
      await page.goto(HOTSEAT);
      await expect(page.getByTestId('table')).toBeVisible();
      await focusSeatToMove(page);

      let bad = await unreachableBuys(page);
      expect(bad, `start of turn:\n${bad.join('\n')}`).toHaveLength(0);

      // Play every Copper, so IN PLAY grows — when both reverted layouts broke.
      for (let i = 0; i < 8; i += 1) {
        await clearPrompt(page);
        const copper = page.getByTestId('hand').locator('[data-card-id="copper"]').first();
        if ((await copper.count()) === 0) break;
        const before = await page.getByTestId('hand').getByTestId('card').count();
        await copper.click();
        await expect.poll(async () => page.getByTestId('hand').getByTestId('card').count()).toBeLessThan(before);
      }
      await clearPrompt(page);

      bad = await unreachableBuys(page);
      expect(bad, `after the Coppers:\n${bad.join('\n')}`).toHaveLength(0);
      const s1 = await pageScroll(page);
      expect(s1.sh).toBeLessThanOrEqual(s1.ih + 1);
      await checkBudget(page, height);

      // One buy, through the real pointer path.
      const pile = page.locator('[data-testid="pile"][data-buyable="true"]').first();
      if ((await pile.count()) > 0) {
        const id = await pile.getAttribute('data-pile-id');
        const target = page.locator(`[data-pile-id="${id}"]`);
        const countBefore = Number(await target.getAttribute('data-pile-count'));
        await target.getByTestId('buy').click();
        await clearPrompt(page);
        await expect.poll(async () => Number(await target.getAttribute('data-pile-count'))).toBe(countBefore - 1);
      }

      bad = await unreachableBuys(page);
      expect(bad, `after a buy:\n${bad.join('\n')}`).toHaveLength(0);
      const s2 = await pageScroll(page);
      expect(s2.sh).toBeLessThanOrEqual(s2.ih + 1);
      const endBad = await notOnScreen(page, '[data-testid="end-turn"]');
      expect(endBad, endBad.join('\n')).toHaveLength(0);
    });

    test('the hover preview never takes the pointer, and the open drawer keeps the fit', async ({ page }) => {
      await page.goto(HOTSEAT);
      await expect(page.getByTestId('table')).toBeVisible();
      await focusSeatToMove(page);

      const cards = page.getByTestId('hand').getByTestId('card');
      await cards.first().hover();
      await expect(page.getByTestId('card-preview')).toBeVisible();
      let bad = await notOnScreen(page, '[data-testid="hand"] [data-testid="card"]');
      expect(bad, bad.join('\n')).toHaveLength(0);
      bad = await unreachableBuys(page);
      expect(bad, bad.join('\n')).toHaveLength(0);
      await page.mouse.move(2, 2);

      // The drawer is a grid column, not an overlay: opening it narrows the board.
      const toggle = page.getByTestId('drawer-toggle');
      if ((await toggle.getAttribute('aria-pressed')) !== 'true') await toggle.click();
      await expect(page.getByTestId('drawer')).toBeVisible();
      const s = await pageScroll(page);
      expect(s.sh).toBeLessThanOrEqual(s.ih + 1);
      expect(s.sw).toBeLessThanOrEqual(s.iw + 1);
      bad = await notOnScreen(page, '[data-testid="end-turn"]');
      expect(bad, bad.join('\n')).toHaveLength(0);
      bad = await unreachableBuys(page);
      expect(bad, bad.join('\n')).toHaveLength(0);
    });
  });
}

test.describe('phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('stacked, nothing overlaps, and the hand and End turn are reachable', async ({ page }) => {
    await page.goto(HOTSEAT);
    await expect(page.getByTestId('table')).toBeVisible();
    await focusSeatToMove(page);

    const s = await pageScroll(page);
    expect(s.sw, 'no sideways page scroll').toBeLessThanOrEqual(s.iw + 1);

    // The regions stack without overlapping.
    const dock = (await page.getByTestId('dock').boundingBox())!;
    const board = (await page.getByTestId('board-region').boundingBox())!;
    const seats = (await page.getByTestId('opponents').boundingBox())!;
    expect(seats.y + seats.height).toBeLessThanOrEqual(dock.y + 1);
    expect(dock.y + dock.height).toBeLessThanOrEqual(board.y + 1);

    // A real click on a hand card: Playwright fails it if anything intercepts.
    const copper = page.getByTestId('hand').locator('[data-card-id="copper"]').first();
    if ((await copper.count()) > 0) {
      const before = await page.getByTestId('hand').getByTestId('card').count();
      await copper.click();
      await expect.poll(async () => page.getByTestId('hand').getByTestId('card').count()).toBeLessThan(before);
    }

    const end = page.getByTestId('end-turn');
    await end.scrollIntoViewIfNeeded();
    const bad = await notOnScreen(page, '[data-testid="end-turn"]');
    expect(bad, bad.join('\n')).toHaveLength(0);

    // Every Buy is reachable by scrolling the page.
    const unreachable = await page.evaluate(() => {
      const out: string[] = [];
      for (const buy of Array.from(document.querySelectorAll<HTMLElement>('[data-testid="buy"]'))) {
        buy.scrollIntoView({ block: 'center' });
        const r = buy.getBoundingClientRect();
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        if (!hit || !(hit === buy || buy.contains(hit))) out.push(buy.closest('[data-pile-id]')?.getAttribute('data-pile-id') ?? '?');
      }
      return out;
    });
    expect(unreachable, unreachable.join(', ')).toHaveLength(0);
  });
});
