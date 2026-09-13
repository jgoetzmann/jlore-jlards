/**
 * SB-67 in a real browser: a turn that runs out of time passes instead of
 * leaving the table stuck at 0:00, and a match dealt without a timer — from the
 * start screen or from a room's lobby — shows no countdown at all.
 *
 * The hash can carry the timer (`#hotseat:2:t4`), so these wait seconds, not
 * the default minute and a half.
 */

import { test, expect, type Page } from '@playwright/test';

async function turnNumber(page: Page): Promise<number> {
  return Number((await page.getByTestId('turn-number').textContent())?.trim() ?? '0');
}

async function seatToMove(page: Page): Promise<string | null> {
  return page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]').first().getAttribute('data-seat');
}

test.describe('turn timer', () => {
  test('a turn that runs out of time passes to the next player, and keeps passing', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.goto('/#hotseat:2:t4');
    await expect(page.getByTestId('table')).toBeVisible();
    await expect(page.getByTestId('turn-timer')).toBeVisible();
    const turn = await turnNumber(page);
    const seat = await seatToMove(page);

    // Nobody touches anything. Before, the clock sat at 0:00 and the turn never
    // moved. Now it passes on its own, answering any prompt with its default.
    await expect.poll(() => turnNumber(page), { timeout: 20_000 }).toBeGreaterThan(turn);
    await expect.poll(() => seatToMove(page), { timeout: 5_000 }).not.toBe(seat);

    // And again: the clock restarted for the next player rather than staying out.
    const next = await turnNumber(page);
    await expect.poll(() => turnNumber(page), { timeout: 20_000 }).toBeGreaterThan(next);

    expect(errors, errors.join(' | ')).toHaveLength(0);
  });

  test('a table dealt without a timer shows no countdown, and nothing passes on its own', async ({ page }) => {
    await page.goto('/#hotseat:2:t0');
    await expect(page.getByTestId('table')).toBeVisible();
    await expect(page.getByTestId('turn-timer')).toHaveCount(0);
    const turn = await page.getByTestId('turn-number').textContent();
    await page.waitForTimeout(3000);
    await expect(page.getByTestId('turn-number')).toHaveText(turn ?? '');
  });

  test('the start screen turns the hotseat timer off', async ({ page }) => {
    await page.goto('/');
    await page.getByTestId('hotseat-timer').uncheck();
    await page.getByTestId('hotseat').click();
    await expect(page.getByTestId('table')).toBeVisible();
    await expect(page).toHaveURL(/#hotseat:2:t0$/);
    await expect(page.getByTestId('turn-timer')).toHaveCount(0);
  });

  test('a room the host deals with the timer off has no countdown in either browser', async ({ browser }) => {
    const hostCtx = await browser.newContext();
    const guestCtx = await browser.newContext();
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();
    try {
      await host.goto('/');
      await host.getByTestId('create-room').click();
      await expect(host.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });
      await expect.poll(() => new URL(host.url()).hash.replace(/^#/, '')).not.toBe('');
      const code = new URL(host.url()).hash.replace(/^#/, '');

      await host.locator('[data-testid="lobby-timer"][data-on="false"]').click();
      await expect(host.locator('[data-testid="lobby-timer"][data-on="false"]')).toHaveAttribute('aria-pressed', 'true');

      // The guest is told before anything is dealt, and cannot change it.
      await guest.goto(`/#${code}`);
      await expect(guest.getByTestId('lobby-timer-state')).toContainText('no time limit', { timeout: 30_000 });
      await expect(guest.getByTestId('lobby-timer')).toHaveCount(0);

      await expect(host.getByTestId('lobby-player')).toHaveCount(2, { timeout: 30_000 });
      await host.getByTestId('lobby-start').click();
      for (const page of [host, guest]) {
        await expect(page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
        await expect(page.getByTestId('turn-timer')).toHaveCount(0);
      }
    } finally {
      await hostCtx.close().catch(() => undefined);
      await guestCtx.close().catch(() => undefined);
    }
  });
});
