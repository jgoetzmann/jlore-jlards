/**
 * UI-2: the fast paths a player actually uses, in a real browser.
 *
 *   - a digit plays the card the hand shows in that position (MOT-12)
 *   - M and the "Play money" button play every plain Resource at once (TURN-2)
 *   - Space never ends the turn; E does (MOT-12)
 *   - ? opens the key sheet, which lists only keys that work
 *   - card-flight ghosts never linger and are never counted as cards
 *   - a disabled Buy says why (TURN-8)
 *
 * The pure rules behind each of these are unit-tested in
 * test/ui-interaction.test.ts; this spec proves they are wired to the table.
 */

import { test, expect, type Page } from '@playwright/test';

const HOTSEAT = '/#hotseat:2';

async function statValue(page: Page, stat: string): Promise<number> {
  const txt = await page.getByTestId(`stat-${stat}-value`).first().textContent();
  return Number((txt ?? '0').trim());
}

async function focusSeatToMove(page: Page): Promise<void> {
  const toMove = page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]');
  if ((await toMove.count()) > 0) await toMove.first().click();
}

/** Drop focus to the page, the way it lands after a played card unmounts. */
async function blur(page: Page): Promise<void> {
  await page.evaluate(() => {
    if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
}

async function openTable(page: Page): Promise<void> {
  await page.goto(HOTSEAT);
  await expect(page.getByTestId('table')).toBeVisible();
  await focusSeatToMove(page);
  await blur(page);
}

/**
 * The cards the table draws for this seat, zone by zone: hand, in play, and
 * the discard's count. A play moves a card between these; nothing else should.
 */
async function ownCards(page: Page): Promise<{ hand: number; play: number; discard: number }> {
  const hand = await page.getByTestId('hand').getByTestId('card').count();
  const play = await page.getByTestId('in-play').getByTestId('card').count();
  const txt = await page.getByTestId('discard-pile').locator('.dock-pile-label b').textContent();
  return { hand, play, discard: Number((txt ?? '0').trim()) };
}

/**
 * The first Copper in hand that carries a digit badge, with that digit. A
 * random deck can deal cards that leave the table when played (trashed, set
 * aside), so the specs that count cards play a known plain card instead of
 * whatever happens to be first (UI-R1). Null when the hand holds no Copper.
 */
async function firstCopper(page: Page): Promise<{ iid: string; digit: string } | null> {
  // Flimsy cards trash themselves after they are played, so a Flimsy Copper
  // never reaches In play. Fading Blossom gives every card Flimsy; that anomaly
  // failed the digit spec once this fix was in.
  const anomaly = page.getByTestId('anomaly-banner');
  if ((await anomaly.count()) > 0 && /flimsy/i.test((await anomaly.first().getAttribute('title')) ?? '')) {
    return null;
  }
  const coppers = page.getByTestId('hand').locator('[data-testid="card"][data-card-id="copper"]');
  const n = await coppers.count();
  for (let i = 0; i < n; i += 1) {
    const c = coppers.nth(i);
    if ((await c.getAttribute('data-clickable')) !== 'true') continue;
    if (/flimsy/i.test((await c.locator('.keyword-chip').allTextContents()).join(' '))) continue;
    const hint = c.locator('.card-hint');
    if ((await hint.count()) === 0) continue;
    const digit = ((await hint.first().textContent()) ?? '').trim();
    const iid = await c.getAttribute('data-iid');
    if (digit !== '' && iid) return { iid, digit };
  }
  return null;
}

test.describe('interaction — keyboard, Play money, one-click paths', () => {
  test('a digit plays the card shown in that position', async ({ page }) => {
    await openTable(page);
    const hand = page.getByTestId('hand').getByTestId('card');
    // The badge on each card is the key that plays it, in the order shown.
    const n = Math.min(await hand.count(), 9);
    for (let i = 0; i < n; i += 1) {
      await expect(hand.nth(i).locator('.card-hint')).toHaveText(String(i + 1));
    }
    const copper = await firstCopper(page);
    test.skip(copper === null, 'this deal put no Copper in the opening hand');
    if (copper === null) return;
    const before = await hand.count();

    await page.keyboard.press(copper.digit);

    await expect(page.getByTestId('hand').locator(`[data-iid="${copper.iid}"]`)).toHaveCount(0);
    await expect.poll(async () => hand.count()).toBe(before - 1);
    await expect(page.getByTestId('in-play').locator(`[data-iid="${copper.iid}"]`)).toHaveCount(1);
  });

  test('M plays every plain Resource in hand at once', async ({ page }) => {
    await openTable(page);
    const button = page.getByTestId('play-money');
    await expect(button).toBeVisible();
    if (await button.isDisabled()) {
      // An anomaly that makes play order matter disables it, with a reason.
      expect(await button.getAttribute('title')).toBeTruthy();
      return;
    }
    const total = Number(await button.getAttribute('data-total'));
    const coppers = await page.getByTestId('hand').locator('[data-card-id="copper"]').count();
    expect(total).toBeGreaterThanOrEqual(coppers > 0 ? 1 : 0);
    const money = await statValue(page, 'money');

    await page.keyboard.press('m');

    await expect.poll(async () => statValue(page, 'money')).toBe(money + total);
    await expect(page.getByTestId('hand').locator('[data-card-id="copper"]')).toHaveCount(0);
    await expect(button).toBeDisabled();
  });

  test('the Play money button does the same as M', async ({ page }) => {
    await openTable(page);
    const button = page.getByTestId('play-money');
    if (await button.isDisabled()) return;
    const total = Number(await button.getAttribute('data-total'));
    const money = await statValue(page, 'money');
    await button.click();
    await expect.poll(async () => statValue(page, 'money')).toBe(money + total);
  });

  test('Space never ends the turn; E does', async ({ page }) => {
    await openTable(page);
    const seat = await page
      .locator('[data-testid="seat-btn"][data-seat-to-move="true"]')
      .first()
      .getAttribute('data-seat');
    const turn = await page.getByTestId('turn-number').textContent();

    await page.keyboard.press(' ');
    await page.waitForTimeout(300);
    await expect(page.getByTestId('turn-number')).toHaveText(turn ?? '');

    await page.keyboard.press('e');
    await expect
      .poll(async () =>
        page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]').first().getAttribute('data-seat'),
      )
      .not.toBe(seat);
  });

  test('? opens a key sheet that lists only keys that work, and closes again', async ({ page }) => {
    await openTable(page);
    await page.keyboard.press('?');
    const sheet = page.getByTestId('key-help');
    await expect(sheet).toBeVisible();
    await expect(sheet).toContainText('end your turn');
    await expect(sheet).toContainText('play money');
    await expect(sheet).not.toContainText('Space');
    await page.keyboard.press('?');
    await expect(sheet).toHaveCount(0);
    await page.getByTestId('key-help-toggle').click();
    await expect(sheet).toBeVisible();
  });

  test('card-flight ghosts are never counted as cards and never linger', async ({ page }) => {
    await openTable(page);
    const copper = await firstCopper(page);
    test.skip(copper === null, 'this deal put no Copper in the opening hand');
    if (copper === null) return;
    const before = await ownCards(page);
    // Play a card and look straight away, mid-flight.
    await page.keyboard.press(copper.digit);
    const during = await page.evaluate(() => {
      const layer = document.querySelector('.motion-layer');
      return {
        ghostTestIds: layer ? layer.querySelectorAll('[data-testid]').length : 0,
        ghostIids: layer ? layer.querySelectorAll('[data-iid]').length : 0,
      };
    });
    expect(during.ghostTestIds).toBe(0);
    expect(during.ghostIids).toBe(0);
    // The Copper moved hand -> in play; this seat's card total is unchanged,
    // so no ghost was counted as a card anywhere the table draws.
    await expect.poll(async () => (await ownCards(page)).hand).toBe(before.hand - 1);
    const after = await ownCards(page);
    expect(after.play).toBe(before.play + 1);
    expect(after.hand + after.play + after.discard).toBe(before.hand + before.play + before.discard);
    // Every flight is under a quarter second; nothing is left behind.
    await page.waitForTimeout(600);
    const left = await page.evaluate(() => document.querySelector('.motion-layer')?.children.length ?? 0);
    expect(left).toBe(0);
  });

  test('a disabled Buy says why', async ({ page }) => {
    await openTable(page);
    const disabled = page.locator('[data-testid="buy"][disabled]');
    if ((await disabled.count()) === 0) return;
    const title = await disabled.first().getAttribute('title');
    expect(title).toBeTruthy();
    expect(title).not.toBe('Buy');
  });
});
