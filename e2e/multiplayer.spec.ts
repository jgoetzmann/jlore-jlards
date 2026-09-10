/**
 * Two Chromium players, two independent browser contexts, one game.
 *
 * This is the test the project could not otherwise have: the host runs the
 * engine in its own browser, the joiner runs a dumb terminal in another, and
 * they talk over the real relay handler mounted into the dev server. Separate
 * contexts mean separate cookies, separate localStorage and separate seats —
 * not two tabs sharing a session.
 *
 * On the hidden-information test, be precise about which boundary is real.
 * `viewFor` guarantees that what a browser is *given to render* excludes other
 * players' hands and libraries, and that is what is asserted here, against the
 * live DOM of both browsers. It does not guarantee that the shared relay queue
 * is unreadable — ARCHITECTURE.md §6 accepts outright that a determined player
 * could fish another seat's view out of it with devtools. Asserting the
 * stronger property would be asserting something the system never claimed.
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

/** Read the room code out of the host's URL once it has been created. */
async function roomCodeOf(page: Page): Promise<string> {
  await expect.poll(async () => new URL(page.url()).hash.replace(/^#/, '')).not.toBe('');
  return new URL(page.url()).hash.replace(/^#/, '');
}

/**
 * Answer a pending prompt so play can continue.
 *
 * `end-turn` is disabled while `view.pending` is set, so an unanswered prompt
 * stops the table dead — which is exactly what made this suite flaky once the
 * engine started actually delivering prompts instead of dropping them.
 */
async function clearPrompt(page: Page): Promise<boolean> {
  if ((await page.getByTestId('prompt').count()) === 0) return false;
  const dflt = page.getByTestId('prompt-default');
  if ((await dflt.count()) > 0 && (await dflt.first().isEnabled())) {
    await dflt.first().click().catch(() => undefined);
    return true;
  }
  const opt = page.getByTestId('prompt-option');
  if ((await opt.count()) > 0) await opt.first().click().catch(() => undefined);
  const confirm = page.getByTestId('prompt-confirm');
  if ((await confirm.count()) > 0 && (await confirm.first().isEnabled())) {
    await confirm.first().click().catch(() => undefined);
    return true;
  }
  const skip = page.getByTestId('prompt-skip');
  if ((await skip.count()) > 0) {
    await skip.first().click().catch(() => undefined);
    return true;
  }
  return false;
}

async function statValue(page: Page, stat: string): Promise<number> {
  const el = page.getByTestId(`stat-${stat}-value`).first();
  const txt = await el.textContent();
  return Number((txt ?? '0').trim());
}

test.describe('two chromium players over the relay', () => {
  test('a host creates a room and a second browser joins it', async ({ browser }) => {
    const host = await openSeat(browser, 'host');
    const guest = await openSeat(browser, 'guest');

    try {
      await host.page.goto('/');
      await host.page.getByTestId('create-room').click();

      const code = await roomCodeOf(host.page);
      expect(code).toMatch(/^[A-Z0-9]{3,}$/);

      // The host deals and shows a table.
      await expect(host.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      // A completely separate browser joins by URL.
      await guest.page.goto(`/#${code}`);
      await expect(guest.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      // Both are in the same match: same turn number.
      // Read both inside the poll. Snapshotting the host's number as the
      // expected value races: the host keeps advancing while the guest is
      // converging, so the guest ends up agreeing with a number the host has
      // already left behind. This asserts the two browsers agree with *each
      // other*, which is the actual property, rather than with a stale reading.
      await expect
        .poll(
          async () => {
            const h = (await host.page.getByTestId('turn-number').textContent())?.trim();
            const g = (await guest.page.getByTestId('turn-number').textContent())?.trim();
            return h !== undefined && h === g ? h : null;
          },
          { timeout: 30_000, message: 'both browsers should converge on the same turn' },
        )
        .not.toBeNull();

      // They hold different seats.
      const hostId = await host.page.getByTestId('you-are').getAttribute('data-you-id');
      const guestId = await guest.page.getByTestId('you-are').getAttribute('data-you-id');
      expect(hostId).not.toBe(guestId);
    } finally {
      // Teardown must not fail a passing test. Under memory pressure the
      // context can already be gone by the time we get here, and `close()`
      // throwing "Target page, context or browser has been closed" was
      // reporting green assertions as failures.
      await host.ctx.close().catch(() => undefined);
      await guest.ctx.close().catch(() => undefined);
    }
  });

  test('each player sees five cards of their own and only a count of the other', async ({ browser }) => {
    const host = await openSeat(browser, 'host');
    const guest = await openSeat(browser, 'guest');

    try {
      await host.page.goto('/');
      await host.page.getByTestId('create-room').click();
      const code = await roomCodeOf(host.page);
      await expect(host.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      await guest.page.goto(`/#${code}`);
      await expect(guest.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      // B1: five cards each, seen only by their owner — absent an anomaly, which
      // may legitimately change the draw (B85).
      const anomalous = (await host.page.getByTestId('anomaly-banner').count()) > 0;
      const hostHand = await host.page.getByTestId('hand').getByTestId('card').count();
      const guestHand = await guest.page.getByTestId('hand').getByTestId('card').count();
      if (!anomalous) {
        expect(hostHand).toBe(5);
        expect(guestHand).toBe(5);
      } else {
        expect(hostHand).toBeGreaterThan(0);
        expect(guestHand).toBeGreaterThan(0);
      }

      // B22: the opponent panel carries a count, never a card list, and the
      // count is whatever that player's hand actually holds.
      const hostSeesOpp = host.page.getByTestId('opponent').first();
      expect(Number(await hostSeesOpp.getAttribute('data-hand-count'))).toBe(guestHand);
      await expect(hostSeesOpp.getByTestId('card')).toHaveCount(0);
    } finally {
      // Teardown must not fail a passing test. Under memory pressure the
      // context can already be gone by the time we get here, and `close()`
      // throwing "Target page, context or browser has been closed" was
      // reporting green assertions as failures.
      await host.ctx.close().catch(() => undefined);
      await guest.ctx.close().catch(() => undefined);
    }
  });

  test("B21/B22/B111: neither browser renders the other player's hand", async ({ browser }) => {
    const host = await openSeat(browser, 'host');
    const guest = await openSeat(browser, 'guest');

    try {
      await host.page.goto('/');
      await host.page.getByTestId('create-room').click();
      const code = await roomCodeOf(host.page);
      await expect(host.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      await guest.page.goto(`/#${code}`);
      await expect(guest.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      // The guest's own hand, by instance id — the ids that must never reach the host.
      const guestHandIids = await guest.page
        .getByTestId('hand')
        .getByTestId('card')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-iid')).filter(Boolean) as string[]);
      expect(guestHandIids.length, 'the guest holds a hand to leak').toBeGreaterThan(0);

      // Everything the host's document actually contains.
      const hostDom = await host.page.content();
      for (const iid of guestHandIids) {
        expect(hostDom, `host DOM leaked guest hand instance ${iid}`).not.toContain(iid);
      }

      // And the reverse direction.
      const hostHandIids = await host.page
        .getByTestId('hand')
        .getByTestId('card')
        .evaluateAll((els) => els.map((e) => e.getAttribute('data-iid')).filter(Boolean) as string[]);
      const guestDom = await guest.page.content();
      for (const iid of hostHandIids) {
        expect(guestDom, `guest DOM leaked host hand instance ${iid}`).not.toContain(iid);
      }

      // What the relay queue itself carries is a different question, and the
      // architecture is explicit about it: addressed views ride one shared list,
      // so a determined player *could* read another seat's view with devtools.
      // That is the stated privacy bar — "if they wanted to, that's fine" — and
      // pinning it here keeps the test honest about which boundary is real.
      // The boundary that IS enforced is the one asserted above: the host never
      // renders, and is never handed, the guest's hand.
      const guestSawOwnHandInDom = await guest.page
        .getByTestId('hand')
        .getByTestId('card')
        .count();
      expect(guestSawOwnHandInDom, 'the guest can see its own hand').toBe(guestHandIids.length);

      // And the host's opponent panel is a count, not a card list — the actual
      // mechanism by which the DOM stays clean.
      const oppCards = await host.page.getByTestId('opponent').first().getByTestId('card').count();
      expect(oppCards, 'host renders no opponent hand cards').toBe(0);
    } finally {
      // Teardown must not fail a passing test. Under memory pressure the
      // context can already be gone by the time we get here, and `close()`
      // throwing "Target page, context or browser has been closed" was
      // reporting green assertions as failures.
      await host.ctx.close().catch(() => undefined);
      await guest.ctx.close().catch(() => undefined);
    }
  });

  test('a play in one browser reaches the other', async ({ browser }) => {
    const host = await openSeat(browser, 'host');
    const guest = await openSeat(browser, 'guest');

    try {
      await host.page.goto('/');
      await host.page.getByTestId('create-room').click();
      const code = await roomCodeOf(host.page);
      await expect(host.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
      await guest.page.goto(`/#${code}`);
      await expect(guest.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      // Whoever is to move plays a Copper.
      const hostId = await host.page.getByTestId('you-are').getAttribute('data-you-id');
      const activeIsHost = await host.page
        .getByTestId('opponent')
        .first()
        .evaluate((el) => el.querySelector('.opponent-turn') === null);
      const mover = activeIsHost ? host : guest;
      const watcher = activeIsHost ? guest : host;
      expect(hostId).toBeTruthy();

      const copper = mover.page.getByTestId('hand').locator('[data-card-id="copper"]').first();
      await expect(copper).toBeVisible({ timeout: 20_000 });
      const before = await statValue(mover.page, 'money');
      await copper.click();

      // The mover sees their own money rise.
      await expect.poll(async () => statValue(mover.page, 'money'), { timeout: 20_000 }).toBeGreaterThan(before);

      // And the watcher's view of that player updates too — the hand count drops,
      // which proves the host republished a filtered view to the other seat.
      await expect
        .poll(
          async () =>
            Number(await watcher.page.getByTestId('opponent').first().getAttribute('data-hand-count')),
          { timeout: 20_000 },
        )
        .toBeLessThan(5);
    } finally {
      // Teardown must not fail a passing test. Under memory pressure the
      // context can already be gone by the time we get here, and `close()`
      // throwing "Target page, context or browser has been closed" was
      // reporting green assertions as failures.
      await host.ctx.close().catch(() => undefined);
      await guest.ctx.close().catch(() => undefined);
    }
  });

  test('turns alternate between the two browsers', async ({ browser }) => {
    test.setTimeout(180_000);
    const host = await openSeat(browser, 'host');
    const guest = await openSeat(browser, 'guest');

    try {
      await host.page.goto('/');
      await host.page.getByTestId('create-room').click();
      const code = await roomCodeOf(host.page);
      await expect(host.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
      await guest.page.goto(`/#${code}`);
      await expect(guest.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      const startTurn = Number(await host.page.getByTestId('turn-number').textContent());

      // Whichever seat can end its turn, does — three times. Clear any prompt
      // first: end-turn is disabled while one is pending, so an unanswered
      // prompt stalls the table and no turn ever advances.
      for (let i = 0; i < 3; i += 1) {
        for (const seat of [host, guest]) await clearPrompt(seat.page);
        for (const seat of [host, guest]) {
          const btn = seat.page.getByTestId('end-turn');
          if (await btn.isEnabled().catch(() => false)) {
            await btn.click();
            break;
          }
        }
        await host.page.waitForTimeout(1500); // one poll interval
      }
      for (const seat of [host, guest]) await clearPrompt(seat.page);

      // The turn counter moved, and both browsers agree on it.
      await expect
        .poll(async () => Number(await host.page.getByTestId('turn-number').textContent()), {
          timeout: 30_000,
        })
        .toBeGreaterThan(startTurn);

      // Read both inside the poll. Snapshotting the host's number as the
      // expected value races: the host keeps advancing while the guest is
      // converging, so the guest ends up agreeing with a number the host has
      // already left behind. This asserts the two browsers agree with *each
      // other*, which is the actual property, rather than with a stale reading.
      await expect
        .poll(
          async () => {
            const h = (await host.page.getByTestId('turn-number').textContent())?.trim();
            const g = (await guest.page.getByTestId('turn-number').textContent())?.trim();
            return h !== undefined && h === g ? h : null;
          },
          { timeout: 30_000, message: 'both browsers should converge on the same turn' },
        )
        .not.toBeNull();
    } finally {
      // Teardown must not fail a passing test. Under memory pressure the
      // context can already be gone by the time we get here, and `close()`
      // throwing "Target page, context or browser has been closed" was
      // reporting green assertions as failures.
      await host.ctx.close().catch(() => undefined);
      await guest.ctx.close().catch(() => undefined);
    }
  });

  test('a refresh puts a player back in the same seat', async ({ browser }) => {
    const host = await openSeat(browser, 'host');
    const guest = await openSeat(browser, 'guest');

    try {
      await host.page.goto('/');
      await host.page.getByTestId('create-room').click();
      const code = await roomCodeOf(host.page);
      await expect(host.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      await guest.page.goto(`/#${code}`);
      await expect(guest.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
      const seatBefore = await guest.page.getByTestId('you-are').getAttribute('data-you-id');

      await guest.page.reload();
      await expect(guest.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      // The seat cookie survives the reload, so you come back as yourself.
      await expect
        .poll(async () => guest.page.getByTestId('you-are').getAttribute('data-you-id'), { timeout: 30_000 })
        .toBe(seatBefore);
    } finally {
      // Teardown must not fail a passing test. Under memory pressure the
      // context can already be gone by the time we get here, and `close()`
      // throwing "Target page, context or browser has been closed" was
      // reporting green assertions as failures.
      await host.ctx.close().catch(() => undefined);
      await guest.ctx.close().catch(() => undefined);
    }
  });
});
