/**
 * A host who reloads mid-match (SB-65).
 *
 * Before lockstep, the host's browser was the only place the match existed:
 * a reload came back as a joiner of its own room and the table had to be
 * resumed on a new room code. Now every browser folds the same relay list, so
 * a reload is a rejoin: the room is replayed from its first message and the
 * seat cookie binds the host back to seat one. This drives that in two real
 * Chromium contexts over the dev relay, and checks play carries on afterwards.
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

async function roomCodeOf(page: Page): Promise<string> {
  await expect.poll(async () => new URL(page.url()).hash.replace(/^#/, '')).not.toBe('');
  return new URL(page.url()).hash.replace(/^#/, '');
}

async function dealRoom(host: Page, guest: Page): Promise<string> {
  await host.goto('/');
  await host.getByTestId('create-room').click();
  const code = await roomCodeOf(host);
  await expect(host.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });
  await guest.goto(`/#${code}`);
  await expect(host.getByTestId('lobby-player')).toHaveCount(2, { timeout: 30_000 });
  await host.getByTestId('lobby-start').click();
  await expect(host.getByTestId('table')).toBeVisible({ timeout: 30_000 });
  await expect(guest.getByTestId('table')).toBeVisible({ timeout: 30_000 });
  return code;
}

/** Answer whatever prompt is up, so End turn is not held back by it. */
async function clearPrompt(page: Page): Promise<void> {
  if ((await page.getByTestId('prompt').count()) === 0) return;
  const dflt = page.getByTestId('prompt-default');
  if ((await dflt.count()) > 0 && (await dflt.first().isEnabled())) {
    await dflt.first().click().catch(() => undefined);
    return;
  }
  const opt = page.getByTestId('prompt-option');
  if ((await opt.count()) > 0) await opt.first().click().catch(() => undefined);
  const confirm = page.getByTestId('prompt-confirm');
  if ((await confirm.count()) > 0 && (await confirm.first().isEnabled())) {
    await confirm.first().click().catch(() => undefined);
    return;
  }
  const skip = page.getByTestId('prompt-skip');
  if ((await skip.count()) > 0) await skip.first().click().catch(() => undefined);
}

async function turnOf(page: Page): Promise<number> {
  return Number(((await page.getByTestId('turn-number').textContent()) ?? '').trim());
}

/** Whoever can end their turn does, until both browsers agree on a later turn. */
async function advanceTurn(seats: Seat[], past: number): Promise<number> {
  let agreed = 0;
  await expect
    .poll(
      async () => {
        for (const s of seats) await clearPrompt(s.page);
        for (const s of seats) {
          const btn = s.page.getByTestId('end-turn');
          if (await btn.isEnabled().catch(() => false)) {
            await btn.click().catch(() => undefined);
            break;
          }
        }
        const [a, b] = await Promise.all(seats.map((s) => turnOf(s.page)));
        agreed = a === b && a! > past ? a! : 0;
        return agreed;
      },
      { timeout: 45_000, intervals: [400, 800, 1200], message: 'both browsers should reach a later turn' },
    )
    .toBeGreaterThan(past);
  return agreed;
}

test('a host who reloads mid-match comes back as its own seat, in the same room, and play continues', async ({
  browser,
}) => {
  test.setTimeout(180_000);
  const host = await openSeat(browser, 'host');
  const guest = await openSeat(browser, 'guest');

  try {
    const code = await dealRoom(host.page, guest.page);
    const hostId = await host.page.getByTestId('you-are').getAttribute('data-you-id');
    const guestId = await guest.page.getByTestId('you-are').getAttribute('data-you-id');
    expect(hostId).toBeTruthy();
    expect(hostId).not.toBe(guestId);

    // Some history past the deal, so the reload has something to replay.
    const start = await turnOf(host.page);
    let turn = await advanceTurn([host, guest], start);
    turn = await advanceTurn([host, guest], turn);

    await host.page.reload();

    // Same room, the table (not a lobby, not the start screen), the same seat.
    await expect(host.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
    expect(new URL(host.page.url()).hash).toBe(`#${code}`);
    await expect(host.page.getByTestId('lobby')).toHaveCount(0);
    await expect
      .poll(async () => host.page.getByTestId('you-are').getAttribute('data-you-id'), { timeout: 30_000 })
      .toBe(hostId);
    // Caught up to where the room is, not dealt afresh.
    await expect.poll(async () => turnOf(host.page), { timeout: 30_000 }).toBe(turn);

    // And the match carries on between the reloaded host and the guest.
    const after = await advanceTurn([host, guest], turn);
    expect(after).toBeGreaterThan(turn);
    await expect
      .poll(async () => guest.page.getByTestId('you-are').getAttribute('data-you-id'))
      .toBe(guestId);
  } finally {
    await host.ctx.close().catch(() => undefined);
    await guest.ctx.close().catch(() => undefined);
  }
});
