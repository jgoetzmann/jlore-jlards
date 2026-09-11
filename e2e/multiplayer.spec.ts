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

/** Create a room and wait for its lobby. No cards exist yet at this point. */
async function openRoom(page: Page): Promise<string> {
  await page.goto('/');
  await page.getByTestId('create-room').click();
  const code = await roomCodeOf(page);
  await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });
  return code;
}

/**
 * Open a room, get everybody into it, and deal.
 *
 * A room is a lobby before it is a match, so this is no longer "click create and
 * wait for a table": the host opens the room, the guests arrive *into the
 * lobby*, and the host deals only once the roster actually holds them. The
 * `lobby-player` count is the assertion worth having -- it is the one that would
 * have caught the bug this screen replaced, where a match was dealt for a number
 * guessed on the start screen and a guest arriving afterwards had no seat.
 */
async function dealRoom(host: Page, guests: Page[]): Promise<string> {
  const code = await openRoom(host);
  const seats = guests.length + 1;

  // Raise the cap before anyone knocks, so nobody is turned away and then let
  // back in on a heartbeat. A room starts at the 2 seats the start screen offers.
  if (seats > 2) {
    await host.locator(`[data-testid="lobby-seat-cap"][data-cap="${seats}"]`).click();
    await expect(host.getByTestId('lobby-count')).toContainText(`/ ${seats}`);
  }

  for (const guest of guests) await guest.goto(`/#${code}`);
  await expect(host.getByTestId('lobby-player')).toHaveCount(seats, { timeout: 30_000 });

  await host.getByTestId('lobby-start').click();
  await expect(host.getByTestId('table')).toBeVisible({ timeout: 30_000 });
  for (const guest of guests) {
    await expect(guest.getByTestId('table')).toBeVisible({ timeout: 30_000 });
  }
  return code;
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
      // The host opens a room. Nothing is dealt yet: this is a lobby.
      const code = await openRoom(host.page);
      expect(code).toMatch(/^[A-Z0-9]{3,}$/);
      await expect(host.page.getByTestId('lobby-code')).toHaveText(code);
      await expect(host.page.getByTestId('lobby-player')).toHaveCount(1);

      // A completely separate browser joins by URL and lands in the same lobby,
      // where the host can watch them arrive.
      await guest.page.goto(`/#${code}`);
      await expect(guest.page.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });
      await expect(guest.page.getByTestId('lobby-waiting')).toBeVisible({ timeout: 30_000 });
      await expect(host.page.getByTestId('lobby-player')).toHaveCount(2, { timeout: 30_000 });

      // Only now are cards dealt, and for exactly these two.
      await host.page.getByTestId('lobby-start').click();
      await expect(host.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
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
      await dealRoom(host.page, [guest.page]);

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
      await dealRoom(host.page, [guest.page]);

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
      await dealRoom(host.page, [guest.page]);

      // Whoever is to move plays a Copper.
      const hostId = await host.page.getByTestId('you-are').getAttribute('data-you-id');
      const activeIsHost = await host.page
        .getByTestId('opponent')
        .first()
        .evaluate((el) => el.querySelector('.opponent-turn') === null);
      const mover = activeIsHost ? host : guest;
      const watcher = activeIsHost ? guest : host;
      expect(hostId).toBeTruthy();

      // Play a Copper when there is one. Xushi's Game can deal an opening hand
      // with none, and then any clickable card proves the same thing: the
      // watcher sees the mover's hand shrink. Only a Copper promises Money.
      const moverHand = mover.page.getByTestId('hand').getByTestId('card');
      await expect(moverHand.first()).toBeVisible({ timeout: 20_000 });
      const hasCopper = (await mover.page.getByTestId('hand').locator('[data-card-id="copper"]').count()) > 0;
      const copper = hasCopper
        ? mover.page.getByTestId('hand').locator('[data-card-id="copper"]').first()
        : mover.page.getByTestId('hand').locator('[data-testid="card"][data-clickable="true"]').first();
      await expect(copper).toBeVisible({ timeout: 20_000 });
      const before = await statValue(mover.page, 'money');
      // Capture the watcher's view of the mover's hand before the play, so the
      // "it dropped" assertion is relative. Pinning it below 5 assumed a 5-card
      // opening hand, which an anomaly may legitimately change (B85).
      const handBefore = Number(
        await watcher.page.getByTestId('opponent').first().getAttribute('data-hand-count'),
      );
      await copper.click();

      // The mover sees their own money rise.
      if (hasCopper) {
        await expect.poll(async () => statValue(mover.page, 'money'), { timeout: 20_000 }).toBeGreaterThan(before);
      }

      // And the watcher's view of that player updates too — the hand count drops,
      // which proves the host republished a filtered view to the other seat.
      await expect
        .poll(
          async () =>
            Number(await watcher.page.getByTestId('opponent').first().getAttribute('data-hand-count')),
          { timeout: 20_000 },
        )
        .toBeLessThan(handBefore);
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
      await dealRoom(host.page, [guest.page]);

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

  test('three browsers deal together, and three seats come out of it', async ({ browser }) => {
    test.setTimeout(180_000);
    const host = await openSeat(browser, 'host');
    const a = await openSeat(browser, 'guest-a');
    const b = await openSeat(browser, 'guest-b');

    try {
      // This is the case the lobby exists for. The old flow dealt for a number
      // picked before anybody had arrived, so a third player had no seat at all.
      await dealRoom(host.page, [a.page, b.page]);

      const ids = await Promise.all(
        [host, a, b].map((s) => s.page.getByTestId('you-are').getAttribute('data-you-id')),
      );
      expect(new Set(ids).size, 'three browsers, three distinct seats').toBe(3);

      // Each of them sees the other two across the table, and no cards of theirs.
      for (const seat of [host, a, b]) {
        await expect(seat.page.getByTestId('opponent')).toHaveCount(2, { timeout: 30_000 });
        await expect(seat.page.getByTestId('opponents').getByTestId('card')).toHaveCount(0);
      }
    } finally {
      for (const seat of [host, a, b]) await seat.ctx.close().catch(() => undefined);
    }
  });

  test('a browser that arrives after the deal is told so, not left spinning', async ({ browser }) => {
    test.setTimeout(120_000);
    const host = await openSeat(browser, 'host');
    const guest = await openSeat(browser, 'guest');
    const late = await openSeat(browser, 'late');

    try {
      const code = await dealRoom(host.page, [guest.page]);

      // The match was dealt for two, and this browser is not one of them. The
      // answer has to be definite: the failure being fixed is a person sitting
      // on "Joining…" with no information until they give up.
      await late.page.goto(`/#${code}`);
      const lobby = late.page.getByTestId('lobby');
      await expect(lobby).toBeVisible({ timeout: 30_000 });
      await expect
        .poll(async () => lobby.getAttribute('data-lobby-state'), { timeout: 30_000 })
        .toBe('missed');
      await expect(late.page.getByTestId('table')).toHaveCount(0);
    } finally {
      for (const seat of [host, guest, late]) await seat.ctx.close().catch(() => undefined);
    }
  });

  test('a refresh puts a player back in the same seat', async ({ browser }) => {
    const host = await openSeat(browser, 'host');
    const guest = await openSeat(browser, 'guest');

    try {
      await dealRoom(host.page, [guest.page]);
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
