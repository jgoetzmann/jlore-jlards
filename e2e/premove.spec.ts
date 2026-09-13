/**
 * Premoves across two Chromium browsers over the dev relay (SB-68).
 *
 * The waiting seat turns premove mode on, plays a Copper and buys a card on its
 * premoved next turn while the other seat's turn is still running. Nothing is
 * sent: the active browser sees no change. When the active seat ends its turn,
 * the waiting browser sends the queue as one batch and the plays land.
 *
 * Then the roles swap and the other seat premoves a Copper and clears it: a
 * cleared premove never reaches the table. (A rollback forced by the active
 * player's turn needs cards this spec cannot deal on purpose; the unit suite,
 * test/premove.test.ts, covers rollback and the reroll.)
 *
 * PREMOVE_SHOTS=<dir> also writes screenshots of the bar at 1366x768 and 390x844.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

interface Seat {
  ctx: BrowserContext;
  page: Page;
  name: string;
}

async function openSeat(browser: Browser, name: string): Promise<Seat> {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  page.on('pageerror', (e: Error) => console.log(`[${name} pageerror] ${String(e)}`));
  return { ctx, page, name };
}

async function dealRoom(host: Page, guest: Page): Promise<void> {
  await host.goto('/');
  await host.getByTestId('create-room').click();
  await expect.poll(async () => new URL(host.url()).hash.replace(/^#/, '')).not.toBe('');
  const code = new URL(host.url()).hash.replace(/^#/, '');
  await expect(host.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });
  await guest.goto(`/#${code}`);
  await expect(host.getByTestId('lobby-player')).toHaveCount(2, { timeout: 30_000 });
  await host.getByTestId('lobby-start').click();
  await expect(host.getByTestId('table')).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByTestId('table')).toBeVisible({ timeout: 30_000 });
}

/** [active, waiting]: the seat whose End turn is enabled moves first. */
async function roles(a: Seat, b: Seat): Promise<[Seat, Seat]> {
  let active: Seat | null = null;
  await expect
    .poll(
      async () => {
        const ea = await a.page.getByTestId('end-turn').isEnabled();
        const eb = await b.page.getByTestId('end-turn').isEnabled();
        active = ea && !eb ? a : eb && !ea ? b : null;
        return active !== null;
      },
      { timeout: 30_000, message: 'exactly one browser should hold the turn' },
    )
    .toBe(true);
  const first = active as unknown as Seat;
  return [first, first === a ? b : a];
}

async function handCountSeenBy(watcher: Page): Promise<number> {
  return Number(await watcher.getByTestId('opponent').first().getAttribute('data-hand-count'));
}

async function clearPrompt(page: Page): Promise<void> {
  if ((await page.getByTestId('prompt').count()) === 0) return;
  const dflt = page.getByTestId('prompt-default');
  if ((await dflt.count()) > 0 && (await dflt.first().isEnabled())) {
    await dflt.first().click().catch(() => undefined);
  }
}

/** How the End turn button is painted: enough to tell the live turn's green from a disabled button. */
async function endTurnLook(page: Page): Promise<{ bg: string; color: string; border: string; events: string }> {
  return page.getByTestId('end-turn').evaluate((el) => {
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, color: cs.color, border: cs.borderTopColor, events: cs.pointerEvents };
  });
}

/** A Copper in the hand on screen, or any playable card when the deal gave none. */
function copperOrAny(page: Page) {
  return page
    .getByTestId('hand')
    .locator('[data-testid="card"][data-card-id="copper"], [data-testid="card"][data-clickable="true"]')
    .first();
}

test.describe('premoves over the relay (SB-68)', () => {
  test('the waiting seat premoves a Copper and a buy, and they apply when its turn starts', async ({ browser }) => {
    test.setTimeout(240_000);
    const host = await openSeat(browser, 'host');
    const guest = await openSeat(browser, 'guest');

    try {
      await dealRoom(host.page, guest.page);
      const [mover, waiter] = await roles(host, guest);
      const shots = process.env['PREMOVE_SHOTS'];

      // ---- the waiting seat premoves ----
      const toggle = waiter.page.getByTestId('premove-toggle');
      await expect(toggle).toBeEnabled({ timeout: 20_000 });
      if (shots) {
        await waiter.page.setViewportSize({ width: 1366, height: 768 });
        await waiter.page.waitForTimeout(300);
        await waiter.page.screenshot({ path: `${shots}/premove-toggle-1366x768.png` });
      }
      const waiterHandSeenBefore = await handCountSeenBy(mover.page);
      // The waiting seat's End turn, disabled because it is not its turn.
      const liveLook = await endTurnLook(waiter.page);
      await toggle.click();
      await expect(waiter.page.getByTestId('premove-bar')).toBeVisible();
      await expect(waiter.page.getByTestId('table')).toHaveAttribute('data-premove', 'true');
      await expect(waiter.page.getByTestId('premove-bar')).toHaveAttribute('data-count', '0');

      // In premove mode the branch is "your turn", but End turn does nothing
      // there: it must look like the disabled button, not the live turn's green.
      expect((await endTurnLook(mover.page)).bg, 'the live turn paints End turn').not.toBe(liveLook.bg);
      await expect
        .poll(async () => endTurnLook(waiter.page), { timeout: 5_000 })
        .toEqual({ ...liveLook, events: 'none' });

      const card = copperOrAny(waiter.page);
      await expect(card).toBeVisible({ timeout: 20_000 });
      const playedId = await card.getAttribute('data-card-id');
      await card.click();
      await expect(waiter.page.getByTestId('premove-bar')).toHaveAttribute('data-count', '1');
      await expect(waiter.page.getByTestId('in-play').locator(`[data-card-id="${playedId}"]`)).toHaveCount(1);

      const pile = waiter.page.locator('[data-testid="pile"][data-buyable="true"]').first();
      await expect(pile).toBeVisible({ timeout: 20_000 });
      const pileId = await pile.getAttribute('data-pile-id');
      await pile.getByTestId('buy').click();
      await expect(waiter.page.getByTestId('premove-bar')).toHaveAttribute('data-count', '2');
      await expect(waiter.page.getByTestId('stat-buys-value')).toHaveText('0');

      if (shots) {
        await waiter.page.setViewportSize({ width: 1366, height: 768 });
        await waiter.page.waitForTimeout(400);
        await waiter.page.screenshot({ path: `${shots}/premove-bar-1366x768.png` });
        await waiter.page.setViewportSize({ width: 390, height: 844 });
        await waiter.page.waitForTimeout(400);
        await waiter.page.getByTestId('premove-bar').scrollIntoViewIfNeeded();
        await waiter.page.screenshot({ path: `${shots}/premove-bar-390x844.png` });
        await waiter.page.screenshot({ path: `${shots}/premove-bar-390x844-full.png`, fullPage: true });
        await waiter.page.setViewportSize({ width: 1280, height: 720 });
      }

      // PM-1: a reload keeps the queue. The seat comes back from its cookie and
      // the premoves from localStorage; they still go out when the turn starts.
      await waiter.page.reload();
      await expect(waiter.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
      await expect(waiter.page.getByTestId('premove-toggle')).toHaveAttribute('data-count', '2', {
        timeout: 30_000,
      });

      // Nothing was sent: the active browser still sees the full hand.
      await mover.page.waitForTimeout(1500);
      expect(await handCountSeenBy(mover.page)).toBe(waiterHandSeenBefore);
      await expect(mover.page.getByTestId('turn-owner')).toHaveAttribute('data-your-turn', 'true');

      // ---- the active seat ends its turn ----
      await clearPrompt(mover.page);
      await mover.page.getByTestId('end-turn').click();

      // The batch went out at turn start: premove mode is off, the plays are real.
      await expect(waiter.page.getByTestId('turn-owner')).toHaveAttribute('data-your-turn', 'true', {
        timeout: 30_000,
      });
      await expect(waiter.page.getByTestId('premove-bar')).toHaveCount(0);
      await expect(waiter.page.getByTestId('table')).toHaveAttribute('data-premove', 'false');
      await expect(waiter.page.getByTestId('in-play').locator(`[data-card-id="${playedId}"]`)).toHaveCount(1, {
        timeout: 20_000,
      });
      await expect(waiter.page.getByTestId('stat-buys-value')).toHaveText('0');
      // And the other browser saw them: one card fewer in that hand.
      await expect
        .poll(async () => handCountSeenBy(mover.page), { timeout: 20_000 })
        .toBe(waiterHandSeenBefore - 1);
      expect(pileId).toBeTruthy();

      // ---- roles swap: a cleared premove never reaches the table ----
      const moverLiveHand = await mover.page.getByTestId('hand').getByTestId('card').count();
      await expect(mover.page.getByTestId('premove-toggle')).toBeEnabled({ timeout: 20_000 });
      await mover.page.getByTestId('premove-toggle').click();
      await expect(mover.page.getByTestId('premove-bar')).toBeVisible();
      await copperOrAny(mover.page).click();
      await expect(mover.page.getByTestId('premove-bar')).toHaveAttribute('data-count', '1');
      await mover.page.getByTestId('premove-clear').click();
      await expect(mover.page.getByTestId('premove-bar')).toHaveAttribute('data-count', '0');
      await expect(mover.page.getByTestId('in-play').getByTestId('card')).toHaveCount(0);
      await mover.page.getByTestId('premove-live').click();
      await expect(mover.page.getByTestId('table')).toHaveAttribute('data-premove', 'false');
      await expect(mover.page.getByTestId('premove-toggle')).toBeVisible();

      await clearPrompt(waiter.page);
      await waiter.page.getByTestId('end-turn').click();
      await expect(mover.page.getByTestId('turn-owner')).toHaveAttribute('data-your-turn', 'true', {
        timeout: 30_000,
      });
      await mover.page.waitForTimeout(1000);
      await expect(mover.page.getByTestId('in-play').getByTestId('card')).toHaveCount(0);
      await expect(mover.page.getByTestId('hand').getByTestId('card')).toHaveCount(moverLiveHand);
    } finally {
      await host.ctx.close().catch(() => undefined);
      await guest.ctx.close().catch(() => undefined);
    }
  });
});
