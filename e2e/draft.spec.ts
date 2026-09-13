/**
 * The Draft in a real browser: a solo room ticks The Draft in the lobby, starts
 * on its own, makes every pick by clicking, and gets a table whose Draft and
 * Prophet shops hold exactly the picked cards, with an ordinary turn to play.
 * The second test does the first picks at phone width.
 *
 * DRAFT_SHOT_DIR, when set, saves a screenshot of the pick panel at each width.
 */

import { test, expect, type Page } from '@playwright/test';

const SHOT_DIR = process.env['DRAFT_SHOT_DIR'];

async function openDraftRoom(page: Page): Promise<void> {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });

  const box = page.getByTestId('lobby-draft');
  await expect(box).toHaveAttribute('data-on', 'false');
  await box.check();
  await expect(box).toHaveAttribute('data-on', 'true');

  await page.getByTestId('lobby-start').click();
  await expect(page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
  await expect(page.getByTestId('draft-panel')).toBeVisible();
}

/** The slot the panel is showing, or 'gone' once the draft is over. */
async function shownSlot(page: Page): Promise<string> {
  const panel = page.getByTestId('draft-panel');
  if ((await panel.count()) === 0) return 'gone';
  return `${await panel.getAttribute('data-slot-kind')}:${await panel.getAttribute('data-slot')}`;
}

test.describe('The Draft', () => {
  test.use({ viewport: { width: 1366, height: 768 } });

  test('a solo room drafts every slot by clicking, and the shops hold the picks', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await openDraftRoom(page);

    // While drafting: nothing else is live, the pill says so, no clock runs.
    await expect(page.getByTestId('turn-owner')).toHaveText('Drafting');
    await expect(page.getByTestId('turn-timer')).toHaveCount(0);
    await expect(page.getByTestId('shop-draft').getByTestId('pile')).toHaveCount(0);
    await expect(page.getByTestId('shop-prophet').getByTestId('pile')).toHaveCount(0);
    await expect(page.getByTestId('draft-title')).toHaveText('Draft Shop · slot 1 of 10 — pick one');
    await expect(page.getByTestId('draft-progress')).toHaveText('You: 14 left');
    if (SHOT_DIR) await page.screenshot({ path: `${SHOT_DIR}/draft-1366x768.png` });

    const picked: Record<'draft' | 'prophet', string[]> = { draft: [], prophet: [] };
    for (let i = 0; i < 20; i++) {
      const slot = await shownSlot(page);
      if (slot === 'gone') break;
      const kind = slot.split(':')[0] as 'draft' | 'prophet';
      const options = page.getByTestId('draft-option');
      await expect(options).toHaveCount(kind === 'draft' ? 4 : 2);
      const option = options.nth(i % (kind === 'draft' ? 4 : 2));
      picked[kind].push((await option.getAttribute('data-option-def')) ?? '');
      if (kind === 'prophet' && picked.prophet.length === 1 && SHOT_DIR) {
        await page.screenshot({ path: `${SHOT_DIR}/draft-prophet-1366x768.png` });
      }
      await option.click();
      await expect.poll(() => shownSlot(page)).not.toBe(slot);
    }

    expect(picked.draft).toHaveLength(10);
    expect(picked.prophet).toHaveLength(4);
    await expect(page.getByTestId('draft-panel')).toHaveCount(0);
    await expect(page.getByTestId('turn-owner')).toHaveText('Your turn');

    // The shared shops hold exactly the picks, in the order they were made.
    const pileIds = (shop: string) =>
      page.getByTestId(`shop-${shop}`).getByTestId('pile').evaluateAll((els) => els.map((e) => e.getAttribute('data-pile-id')));
    await expect.poll(() => pileIds('draft')).toEqual(picked.draft.map((d) => `draft:${d}`));
    await expect.poll(() => pileIds('prophet')).toEqual(picked.prophet.map((d) => `prophet:${d}`));

    // And an ordinary turn plays: money, then End turn.
    await expect(page.getByTestId('turn-number')).toHaveText('1');
    const playMoney = page.getByTestId('play-money');
    const acted = await playMoney.isEnabled();
    if (acted) await playMoney.click();
    // MERGE-5: the first change after the Draft ends refreshes the resume
    // snapshot, still on turn 1. Keyed on the turn alone it waited for turn 2.
    if (acted) {
      await expect
        .poll(
          () =>
            page.evaluate(() => {
              const raw = localStorage.getItem('jlore_snapshot');
              if (!raw) return 'none';
              const snap = JSON.parse(raw) as { state?: { turn?: number; draft?: unknown } };
              return `turn ${snap.state?.turn}: ${snap.state?.draft == null ? 'playing' : 'drafting'}`;
            }),
          { timeout: 15_000 },
        )
        .toBe('turn 1: playing');
    }
    await page.getByTestId('end-turn').click();
    await expect(page.getByTestId('turn-number')).toHaveText('2');

    expect(errors, errors.join(' | ')).toHaveLength(0);
  });

  test('a timed room picks the first option for a seat that sits out the turn timer (DRAFT-4)', async ({ page }) => {
    // The lobby's timer is on by default (90 s). The page clock runs normally
    // until it is fast-forwarded past that deadline.
    await page.clock.install();
    await openDraftRoom(page);
    await expect(page.getByTestId('draft-progress')).toHaveText('You: 14 left');
    const first = await shownSlot(page);
    await page.waitForTimeout(500);
    await expect(page.getByTestId('draft-progress')).toHaveText('You: 14 left');

    // Nobody picks. Past the deadline, the slot is picked for this seat...
    await page.clock.fastForward('01:35');
    await expect.poll(() => shownSlot(page), { timeout: 15_000 }).not.toBe(first);
    await expect(page.getByTestId('draft-progress')).toHaveText('You: 13 left');
    // ...and the deadline starts again for the next one.
    await page.clock.fastForward('01:35');
    await expect(page.getByTestId('draft-progress')).toHaveText('You: 12 left', { timeout: 15_000 });
  });
});

test.describe('The Draft at phone width', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('the lobby starts the THE DRAFT line with its checkbox beside it (MOB-5)', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('create-room').click();
    await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });

    const first = await page.locator('.lobby-settings .lobby-caps-label').first().boundingBox();
    const label = await page.locator('.lobby-draft-label').boundingBox();
    const box = await page.getByTestId('lobby-draft').boundingBox();
    expect(first && label && box).toBeTruthy();
    // The heading starts its own line, level with the row's first heading...
    expect(Math.abs(label!.x - first!.x)).toBeLessThanOrEqual(2);
    expect(label!.y).toBeGreaterThan(first!.y + first!.height / 2);
    // ...and its checkbox sits beside it on that line, not on the next one.
    expect(box!.x).toBeGreaterThan(label!.x + label!.width);
    expect(Math.abs(box!.y + box!.height / 2 - (label!.y + label!.height / 2))).toBeLessThanOrEqual(12);

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - 390);
    expect(overflow).toBeLessThanOrEqual(0);
  });

  test('the pick panel fits a 390px screen and a pick works by tapping', async ({ page }) => {
    await openDraftRoom(page);
    const panel = page.getByTestId('draft-panel');
    await panel.scrollIntoViewIfNeeded();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow).toBeLessThanOrEqual(0);
    const options = page.getByTestId('draft-option');
    await expect(options).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      const box = await options.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.x).toBeGreaterThanOrEqual(0);
      expect(box!.x + box!.width).toBeLessThanOrEqual(390);
    }
    if (SHOT_DIR) {
      await page.getByTestId('draft-title').scrollIntoViewIfNeeded();
      await page.screenshot({ path: `${SHOT_DIR}/draft-390x844.png` });
      await page.screenshot({ path: `${SHOT_DIR}/draft-390x844-full.png`, fullPage: true });
    }

    const first = await shownSlot(page);
    await options.nth(3).click();
    await expect.poll(() => shownSlot(page)).not.toBe(first);
    await expect(page.getByTestId('draft-progress')).toHaveText('You: 13 left');
  });
});
