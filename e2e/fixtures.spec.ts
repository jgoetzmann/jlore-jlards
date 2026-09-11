/**
 * Table states a random hotseat deal rarely reaches, seen in a real browser.
 *
 * `#fixture:<name>` (dev server only, src/ui/Fixture.tsx) mounts the real
 * TableLayout over a real seedMatch with one crafted piece: a pile prompt,
 * another seat's prompt, or a second view a step on. The unit suite renders
 * the same components as markup; this proves they lay out and click.
 *
 *   - a pile prompt answers from a bar in the dock and the lit piles (LAY-4)
 *   - hotseat: someone else's decision is a "Pass to <name>" chip, never a
 *     blocker, and the pass lands on the chooser's prompt (MOT-11)
 *   - a trashed card fades out where it stood, and an opponent's play flies
 *     out of their hand fan into their tableau (MOT-15)
 *
 * Set FIXTURE_SHOT_DIR to also save a screenshot of each state.
 */

import { test, expect, type Page } from '@playwright/test';

const SHOTS = process.env['FIXTURE_SHOT_DIR'];

async function shot(page: Page, name: string): Promise<void> {
  if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` });
}

async function sent(page: Page): Promise<Array<Record<string, unknown>>> {
  return page.evaluate(() => (window as unknown as { __fixtureSent?: Array<Record<string, unknown>> }).__fixtureSent ?? []);
}

async function insideViewport(page: Page, testId: string): Promise<void> {
  const box = await page.getByTestId(testId).first().boundingBox();
  const vp = page.viewportSize();
  expect(box).not.toBeNull();
  expect(vp).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(vp!.height + 1);
}

test.describe('fixtures — rare table states in a real browser', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('a pile prompt: a bar in the dock, the lit piles toggle, Confirm resolves', async ({ page }) => {
    await page.goto('/#fixture:pile-pick');
    const bar = page.getByTestId('dock').getByTestId('prompt');
    await expect(bar).toBeVisible();
    await expect(bar).toHaveAttribute('data-placement', 'board');
    await insideViewport(page, 'prompt');
    // Never a full-screen blocker: the hand and End turn are still on screen.
    await insideViewport(page, 'hand');
    await insideViewport(page, 'end-turn');
    expect(await page.evaluate(() => document.scrollingElement!.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);

    const lit = page.locator('.pile.pile-prompt-target');
    await expect(lit).toHaveCount(3);
    await expect(page.getByTestId('prompt-confirm')).toBeDisabled();

    const target = lit.nth(1);
    const pileId = await target.getAttribute('data-pile-id');
    await target.scrollIntoViewIfNeeded();
    await target.getByTestId('card').click();
    await expect(target).toHaveClass(/pile-prompt-picked/);
    await expect(page.locator('.pile.pile-prompt-picked')).toHaveCount(1);
    await shot(page, 'fixture-pile-pick');

    // A second pile swaps the single pick rather than refusing it.
    const other = lit.nth(0);
    await other.scrollIntoViewIfNeeded();
    await other.getByTestId('card').click();
    await expect(other).toHaveClass(/pile-prompt-picked/);
    await expect(target).not.toHaveClass(/pile-prompt-picked/);
    const otherId = await other.getAttribute('data-pile-id');
    expect(otherId).not.toBe(pileId);

    await page.getByTestId('prompt-confirm').click();
    await expect(page.getByTestId('prompt')).toHaveCount(0);
    const last = (await sent(page)).at(-1);
    expect(last).toMatchObject({ type: 'resolve', promptId: 'fx-pile', keys: [otherId] });
  });

  test('hotseat: another seat’s decision is a "Pass to" chip, and the pass lands on it', async ({ page }) => {
    await page.goto('/#fixture:pass');
    const chip = page.getByTestId('topbar').getByTestId('prompt-waiting');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('Pass to');
    await insideViewport(page, 'prompt-waiting');
    // Nothing of yours is covered: no prompt, your hand and the board are live.
    await expect(page.getByTestId('prompt')).toHaveCount(0);
    await insideViewport(page, 'hand');
    const chooser = await page.locator('[data-testid="seat-btn"][data-seat="s2"]').textContent();
    await expect(chip).toContainText((chooser ?? '').trim());
    // The chip must not wrap the topbar onto a second row (it did: the Log
    // toggle dropped below and the whole table moved down 30px).
    for (const width of [1366, 1280]) {
      await page.setViewportSize({ width, height: 768 });
      const bar = await page.getByTestId('topbar').boundingBox();
      const log = await page.getByTestId('drawer-toggle').boundingBox();
      expect(bar!.height, `topbar height at ${width}px`).toBeLessThanOrEqual(50);
      expect(log!.y + log!.height, `Log toggle inside the topbar at ${width}px`).toBeLessThanOrEqual(bar!.y + bar!.height);
    }
    await page.setViewportSize({ width: 1366, height: 768 });
    await shot(page, 'fixture-pass');

    const me = await page.getByTestId('you-are').getAttribute('data-you-id');
    await page.getByTestId('prompt-pass').click();
    await expect(page.getByTestId('you-are')).not.toHaveAttribute('data-you-id', me ?? '');
    await expect(page.getByTestId('prompt')).toBeVisible();
    await expect(page.getByTestId('prompt-waiting')).toHaveCount(0);
    await shot(page, 'fixture-pass-after');

    // A one-of-two choose submits on the click (TURN-7).
    const option = page.getByTestId('prompt-option').first();
    const key = await option.getAttribute('data-option-key');
    await option.click();
    await expect(page.getByTestId('prompt')).toHaveCount(0);
    expect((await sent(page)).at(-1)).toMatchObject({ type: 'resolve', promptId: 'fx-pass', keys: [key] });
  });

  test('a trashed card fades out where it stood; an opponent’s play flies from their fan', async ({ page }) => {
    await page.goto('/#fixture:motion');
    await page.getByTestId('opponent').first().click();
    await expect(page.getByTestId('seat-detail')).toBeVisible();
    const handBefore = await page.getByTestId('hand').getByTestId('card').count();
    const tableauBefore = await page.getByTestId('seat-tableau').getByTestId('seat-card').count();

    // Record every ghost the step creates, however short-lived.
    await page.evaluate(() => {
      const w = window as unknown as { __flights: string[] };
      w.__flights = [];
      new MutationObserver((records) => {
        for (const r of records) {
          for (const n of Array.from(r.addedNodes)) {
            if (n instanceof HTMLElement && n.classList.contains('motion-ghost')) {
              w.__flights.push(n.getAttribute('data-flight') ?? '?');
            }
          }
        }
      }).observe(document.body, { childList: true, subtree: true });
    });

    await page.getByTestId('fixture-step').click();
    await expect(page.getByTestId('hand').getByTestId('card')).toHaveCount(handBefore - 1);
    await expect(page.getByTestId('seat-tableau').getByTestId('seat-card')).toHaveCount(tableauBefore + 1);
    const flights = await page.evaluate(() => (window as unknown as { __flights: string[] }).__flights);
    expect(flights).toContain('exit');
    expect(flights).toContain('deal');

    // Both are under a fifth of a second, and nothing is left behind.
    await page.waitForTimeout(500);
    expect(await page.evaluate(() => document.querySelector('.motion-layer')?.children.length ?? 0)).toBe(0);
    // Ghosts are never cards: the opponents panel still holds no card testid.
    await expect(page.getByTestId('opponents').getByTestId('card')).toHaveCount(0);
  });
});
