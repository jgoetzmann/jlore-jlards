/**
 * A real two-player game, played through the UI in one browser.
 *
 * Hotseat is genuinely two players — two seats, two hands, alternating turns —
 * it just renders them in one tab. Everything here drives the actual DOM: no
 * engine imports, no fixtures. If the game cannot be played by clicking, these
 * fail.
 */

import { test, expect, type Page } from '@playwright/test';

const HOTSEAT = '/#hotseat:2';

async function statValue(page: Page, stat: string): Promise<number> {
  const txt = await page.getByTestId(`stat-${stat}-value`).first().textContent();
  return Number((txt ?? '0').trim());
}

/** Answer any prompt that is blocking play, so a turn can finish. */
async function clearPrompt(page: Page): Promise<boolean> {
  const prompt = page.getByTestId('prompt');
  if ((await prompt.count()) === 0) return false;
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

/** The seat whose turn it is, in hotseat. */
async function focusSeatToMove(page: Page): Promise<void> {
  const toMove = page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]');
  if ((await toMove.count()) > 0) await toMove.first().click();
}

test.describe('hotseat — a game you can actually play', () => {
  test('the table deals: 5 cards in hand, a shop, and turn 1', async ({ page }) => {
    await page.goto(HOTSEAT);
    await expect(page.getByTestId('table')).toBeVisible();

    // B1: opening hand is 5.
    await expect(page.getByTestId('hand').getByTestId('card')).toHaveCount(5);

    // B44: the fixed shops are always present.
    await expect(page.getByTestId('shop-resource')).toBeVisible();
    await expect(page.getByTestId('shop-points')).toBeVisible();
    await expect(page.getByTestId('shop-draft')).toBeVisible();

    // B45: ten draft piles.
    await expect(page.getByTestId('shop-draft').getByTestId('pile')).toHaveCount(10);

    await expect(page.getByTestId('turn-number')).toHaveText('1');
  });

  test('B3: the turn opens with 1 Action, 1 Buy, 0 Money', async ({ page }) => {
    await page.goto(HOTSEAT);
    await expect(page.getByTestId('table')).toBeVisible();
    await focusSeatToMove(page);

    const actions = await statValue(page, 'actions');
    const buys = await statValue(page, 'buys');
    const money = await statValue(page, 'money');

    // B3 is the baseline reset, but B85 says a stat anomaly applies its delta at
    // every turn reset — and anomalies roll at 0.3, so roughly a third of games
    // legitimately open somewhere other than 1/1/0. Asserting the bare baseline
    // made this test fail ~30% of the time against a correct engine (caught as
    // "Extra Gold!" opening on 1 Money, and Less Money! would open on -1).
    // With no anomaly the baseline is exact; with one, every stat anomaly in the
    // catalog is exactly +/-1 on a single stat, so the window is one.
    const anomalous = (await page.getByTestId('anomaly-banner').count()) > 0;
    if (!anomalous) {
      expect(actions).toBe(1);
      expect(buys).toBe(1);
      expect(money).toBe(0);
    } else {
      expect(actions).toBeGreaterThanOrEqual(0);
      expect(actions).toBeLessThanOrEqual(2);
      expect(buys).toBeGreaterThanOrEqual(0);
      expect(buys).toBeLessThanOrEqual(2);
      expect(money).toBeGreaterThanOrEqual(-1);
      expect(money).toBeLessThanOrEqual(1);
    }
  });

  test('B4: playing a Copper raises Money without spending an Action', async ({ page }) => {
    await page.goto(HOTSEAT);
    await expect(page.getByTestId('table')).toBeVisible();
    await focusSeatToMove(page);

    const copper = page.getByTestId('hand').locator('[data-card-id="copper"]').first();
    await expect(copper).toBeVisible();

    const moneyBefore = await statValue(page, 'money');
    const actionsBefore = await statValue(page, 'actions');
    await copper.click();

    await expect
      .poll(async () => statValue(page, 'money'), { message: 'money should rise' })
      .toBeGreaterThan(moneyBefore);
    // Resources cost no Action.
    expect(await statValue(page, 'actions')).toBe(actionsBefore);
  });

  test('B5: buying a card spends the Buy and puts it in the discard', async ({ page }) => {
    await page.goto(HOTSEAT);
    await expect(page.getByTestId('table')).toBeVisible();
    await focusSeatToMove(page);

    // Play every Copper to bank money. Wait for the hand to shrink each time
    // rather than sleeping, so this does not race the re-render, and clear any
    // prompt in between — the overlay covers the board, so clicking through it
    // waits for actionability until the test times out.
    for (let i = 0; i < 5; i += 1) {
      await clearPrompt(page);
      const copper = page.getByTestId('hand').locator('[data-card-id="copper"]').first();
      if ((await copper.count()) === 0) break;
      const before = await page.getByTestId('hand').getByTestId('card').count();
      await copper.click();
      await expect.poll(async () => page.getByTestId('hand').getByTestId('card').count()).toBeLessThan(before);
    }
    await clearPrompt(page);

    expect(await statValue(page, 'money')).toBeGreaterThan(0);
    expect(await statValue(page, 'buys')).toBe(1);

    // Pin the pile by id. `[data-buyable="true"]` is a live set that re-orders
    // as money changes, so `.first()` would point somewhere else after the buy.
    //
    // Prefer the Copper pile: it costs 0 so it is always buyable, and it sits at
    // the top of the Resource Shop. Taking whatever happened to be first could
    // land deep inside the Prophet Shop's 23-pile scroll column, where the Buy
    // button is intermittently unreachable and the click waits out the timeout.
    const copperPile = page.locator('[data-pile-id="resource:copper"][data-buyable="true"]');
    const pileId =
      (await copperPile.count()) > 0
        ? 'resource:copper'
        : await page.locator('[data-testid="pile"][data-buyable="true"]').first().getAttribute('data-pile-id');
    expect(pileId, 'something should be affordable').toBeTruthy();
    const pile = page.locator(`[data-pile-id="${pileId}"]`);
    const countBefore = Number(await pile.getAttribute('data-pile-count'));

    await clearPrompt(page);
    const buyBtn = pile.getByTestId('buy');
    await buyBtn.scrollIntoViewIfNeeded();
    await buyBtn.click();
    // A Play-on-Buy card resolves as it is bought and can raise a prompt.
    await clearPrompt(page);

    // The Buy is spent and that specific pile lost exactly one card.
    await expect.poll(async () => statValue(page, 'buys'), { message: 'buys should drop' }).toBe(0);
    await expect
      .poll(async () => Number(await pile.getAttribute('data-pile-count')))
      .toBe(countBefore - 1);
  });

  test('B6/B7: ending a turn passes to the other seat and redeals a hand of 5', async ({ page }) => {
    await page.goto(HOTSEAT);
    await expect(page.getByTestId('table')).toBeVisible();
    await focusSeatToMove(page);

    const firstSeat = await page
      .locator('[data-testid="seat-btn"][data-seat-to-move="true"]')
      .first()
      .getAttribute('data-seat');

    await clearPrompt(page);
    await page.getByTestId('end-turn').click();

    // The other seat is now to move.
    await expect
      .poll(async () =>
        page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]').first().getAttribute('data-seat'),
      )
      .not.toBe(firstSeat);

    // B7: the hand is redrawn to 5 at end of turn.
    await focusSeatToMove(page);
    await expect(page.getByTestId('hand').getByTestId('card')).toHaveCount(5);
  });

  test('each seat sees its own hand, and the opponent only as a count', async ({ page }) => {
    await page.goto(HOTSEAT);
    await expect(page.getByTestId('table')).toBeVisible();

    const seats = page.getByTestId('seat-btn');
    await expect(seats).toHaveCount(2);

    await seats.nth(0).click();
    const seat0You = await page.getByTestId('you-are').getAttribute('data-you-id');
    const seat0Hand = await page.getByTestId('hand').getByTestId('card').count();

    await seats.nth(1).click();
    const seat1You = await page.getByTestId('you-are').getAttribute('data-you-id');

    expect(seat0You).not.toBe(seat1You);
    expect(seat0Hand).toBe(5);

    // The opponent panel reports a count, never a card list.
    const opponent = page.getByTestId('opponent').first();
    await expect(opponent).toHaveAttribute('data-hand-count', '5');
    await expect(opponent.getByTestId('card')).toHaveCount(0);
  });

  test('twelve turns of real play leave the game consistent', async ({ page }) => {
    test.setTimeout(180_000);
    await page.goto(HOTSEAT);
    await expect(page.getByTestId('table')).toBeVisible();

    for (let turn = 0; turn < 12; turn += 1) {
      if (await page.getByTestId('game-over').isVisible().catch(() => false)) break;

      await focusSeatToMove(page);
      await clearPrompt(page);

      // Play whatever is playable, resolving prompts as they appear.
      for (let i = 0; i < 6; i += 1) {
        if (await clearPrompt(page)) continue;
        const playable = page.getByTestId('hand').locator('[data-clickable="true"]');
        if ((await playable.count()) === 0) break;
        await playable.first().click();
        await page.waitForTimeout(60);
      }

      await clearPrompt(page);

      // Buy something if anything is affordable.
      const buyable = page.locator('[data-testid="pile"][data-buyable="true"]');
      if ((await buyable.count()) > 0) {
        await buyable.first().getByTestId('buy').click();
        await page.waitForTimeout(80);
      }

      await clearPrompt(page);

      const endTurn = page.getByTestId('end-turn');
      if (await endTurn.isEnabled().catch(() => false)) {
        await endTurn.click();
        await page.waitForTimeout(120);
      }
    }

    // The turn counter advanced and nothing crashed.
    const turnNow = Number(await page.getByTestId('turn-number').textContent());
    expect(turnNow).toBeGreaterThan(1);
    await expect(page.getByTestId('table')).toBeVisible();
    await expect(page.getByTestId('fatal')).toHaveCount(0);
  });

  test('no console errors during a normal opening', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error') errors.push(m.text());
    });
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto(HOTSEAT);
    await expect(page.getByTestId('table')).toBeVisible();
    await focusSeatToMove(page);

    const playable = page.getByTestId('hand').locator('[data-clickable="true"]');
    if ((await playable.count()) > 0) await playable.first().click();
    await page.waitForTimeout(300);

    expect(errors, `console errors: ${errors.join(' | ')}`).toHaveLength(0);
  });
});
