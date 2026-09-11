/**
 * Play a real game and photograph it.
 *
 * Not an assertion suite — a visual record. It drives the same DOM the other
 * specs do, but its job is to produce images a person (or a model) can look at
 * and judge: is the card text readable at the size it actually renders, does the
 * art fight the frame, can you tell whose turn it is, does a prompt overlay
 * obscure the thing it is asking about.
 *
 *   npm run shots
 *
 * Output lands in `shots/`, numbered in the order a player would meet them.
 *
 * Deliberately excluded from `npm run e2e` and therefore from CI: it plays 26
 * turns and takes about a quarter of an hour, and it asserts almost nothing —
 * gating a build on a documentation tool buys nothing and cost a CI timeout.
 * The suites that do assert (hotseat, multiplayer, art) run in about two
 * minutes together.
 */

import { test, expect, type Page } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'shots';
mkdirSync(OUT, { recursive: true });

let n = 0;
async function shot(page: Page, name: string, opts: { full?: boolean } = {}): Promise<void> {
  n += 1;
  const file = `${OUT}/${String(n).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: file, fullPage: opts.full ?? false });
  console.log(`shot: ${file}`);
}

async function focusSeatToMove(page: Page): Promise<void> {
  const toMove = page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]');
  if ((await toMove.count()) > 0) await toMove.first().click();
}

async function clearPrompt(page: Page): Promise<boolean> {
  if ((await page.getByTestId('prompt').count()) === 0) return false;
  const dflt = page.getByTestId('prompt-default');
  if ((await dflt.count()) > 0 && (await dflt.first().isEnabled())) {
    await dflt.first().click();
    return true;
  }
  const opt = page.getByTestId('prompt-option');
  if ((await opt.count()) > 0) await opt.first().click();
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

test.describe('visual record', () => {
  test.use({ viewport: { width: 1600, height: 1000 } });

  test('a full hotseat game, photographed', async ({ page }) => {
    test.setTimeout(900_000);

    // 1. What a player sees first.
    await page.goto('/');
    await expect(page.getByTestId('create-room')).toBeVisible();
    await shot(page, 'start-screen');

    // 2. The dealt table.
    await page.goto('/#hotseat:2');
    await expect(page.getByTestId('table')).toBeVisible();
    await page.waitForLoadState('networkidle').catch(() => undefined);
    await focusSeatToMove(page);
    await shot(page, 'table-dealt');
    await shot(page, 'table-dealt-full', { full: true });

    // 3. The hand, close up — the single most-read element in the game.
    const hand = page.getByTestId('hand');
    await hand.screenshot({ path: `${OUT}/04-hand-closeup.png` });
    console.log(`shot: ${OUT}/04-hand-closeup.png`);
    n = 4;

    // 4. One card at full size, to judge text legibility and art/frame contrast.
    const card = hand.getByTestId('card').first();
    await card.screenshot({ path: `${OUT}/05-card-single.png` });
    console.log(`shot: ${OUT}/05-card-single.png`);
    n = 5;

    // 5. The shop board.
    const board = page.getByTestId('board');
    await board.screenshot({ path: `${OUT}/06-shop-board.png` });
    console.log(`shot: ${OUT}/06-shop-board.png`);
    n = 6;

    // 6. Mid-turn: money banked, cards in play.
    for (let i = 0; i < 4; i += 1) {
      const copper = hand.locator('[data-card-id="copper"]').first();
      if ((await copper.count()) === 0) break;
      const before = await hand.getByTestId('card').count();
      await copper.click();
      await expect.poll(async () => hand.getByTestId('card').count()).toBeLessThan(before);
    }
    await shot(page, 'mid-turn-money-banked');

    // 7. A purchase.
    const buyable = page.locator('[data-testid="pile"][data-buyable="true"]');
    if ((await buyable.count()) > 0) {
      await buyable.first().getByTestId('buy').click();
      await page.waitForTimeout(400);
      await shot(page, 'after-a-purchase');
    }

    // 8. Play on into later turns, catching a prompt if one appears.
    //
    // Bounded by wall clock, not just turn count. A late-game turn resolves far
    // more than an early one, so a fixed turn budget ran past the test timeout
    // and lost the later-turn shots entirely — the most interesting ones, since
    // they show a grown deck and a full graveyard.
    const deadline = Date.now() + 6 * 60 * 1000;
    let promptShot = false;
    for (let turn = 0; turn < 26; turn += 1) {
      if (Date.now() > deadline) break;
      if (await page.getByTestId('game-over').isVisible().catch(() => false)) break;
      await focusSeatToMove(page);

      if (!promptShot && (await page.getByTestId('prompt').count()) > 0) {
        await shot(page, 'prompt-overlay');
        promptShot = true;
      }
      await clearPrompt(page);

      for (let i = 0; i < 6; i += 1) {
        if (Date.now() > deadline) break;
        if (await clearPrompt(page)) {
          if (!promptShot && (await page.getByTestId('prompt').count()) > 0) {
            await shot(page, 'prompt-overlay');
            promptShot = true;
          }
          continue;
        }
        const playable = hand.locator('[data-clickable="true"]');
        if ((await playable.count()) === 0) break;
        await playable.first().click({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(80);
        if (!promptShot && (await page.getByTestId('prompt').count()) > 0) {
          await shot(page, 'prompt-overlay');
          promptShot = true;
        }
      }

      await clearPrompt(page);
      // Cycle through the buyable draft piles so the run buys varied cards and
      // eventually reaches a prompt, rather than buying Copper forever.
      //
      // Scoped to the Draft Shop by test id, not by a positional `:below()`
      // selector: positional selectors resolve against rendered geometry, which
      // differs between a local run and CI's font metrics, and there it picked
      // piles whose Buy button was overlapped.
      const draftBuyable = page
        .getByTestId('shop-draft')
        .locator('[data-testid="pile"][data-buyable="true"]');
      const anyBuyable = page.locator('[data-testid="pile"][data-buyable="true"]');
      const target = (await draftBuyable.count()) > 0 ? draftBuyable : anyBuyable;
      const n = await target.count();
      if (n > 0) {
        const btn = target.nth(turn % n).getByTestId('buy');
        await btn.scrollIntoViewIfNeeded().catch(() => undefined);
        await btn.click({ timeout: 15_000 }).catch(() => undefined);
        await page.waitForTimeout(100);
      }
      await clearPrompt(page);

      const end = page.getByTestId('end-turn');
      if (await end.isEnabled().catch(() => false)) {
        await end.click({ timeout: 10_000 }).catch(() => undefined);
        await page.waitForTimeout(150);
      }
    }

    // 9. A later turn — a deck that has grown, more going on.
    await focusSeatToMove(page);
    await shot(page, 'later-turn');
    await shot(page, 'later-turn-full', { full: true });

    // 10. The graveyard / play area, where bought cards accumulate.
    const side = page.locator('.table-side');
    if ((await side.count()) > 0) {
      await side.screenshot({ path: `${OUT}/${String(n + 1).padStart(2, '0')}-side-panel.png` });
      console.log(`shot: ${OUT}/side-panel`);
      n += 1;
    }
  });

  test('two browsers side by side', async ({ browser }) => {
    test.setTimeout(180_000);
    const hostCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const guestCtx = await browser.newContext({ viewport: { width: 1500, height: 950 } });
    const host = await hostCtx.newPage();
    const guest = await guestCtx.newPage();

    try {
      await host.goto('/');
      await host.getByTestId('create-room').click();
      await expect.poll(async () => new URL(host.url()).hash).not.toBe('');
      const code = new URL(host.url()).hash.replace(/^#/, '');

      // A room is a lobby before it is a match, and the lobby is a screen a
      // player can spend half a minute on, so it belongs in the visual record.
      await expect(host.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });
      await host.waitForLoadState('networkidle').catch(() => undefined);
      await host.screenshot({ path: `${OUT}/19a-lobby-host.png` });
      console.log(`shot: ${OUT}/19a-lobby-host.png`);

      await guest.goto(`/#${code}`);
      await expect(guest.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });
      await expect(host.getByTestId('lobby-player')).toHaveCount(2, { timeout: 30_000 });
      await host.screenshot({ path: `${OUT}/19b-lobby-filling.png` });
      console.log(`shot: ${OUT}/19b-lobby-filling.png`);

      await host.getByTestId('lobby-start').click();
      await expect(host.getByTestId('table')).toBeVisible({ timeout: 30_000 });
      await host.waitForLoadState('networkidle').catch(() => undefined);
      await expect(guest.getByTestId('table')).toBeVisible({ timeout: 30_000 });
      await guest.waitForLoadState('networkidle').catch(() => undefined);

      await host.screenshot({ path: `${OUT}/20-mp-host.png` });
      await guest.screenshot({ path: `${OUT}/21-mp-guest.png` });
      console.log(`shot: ${OUT}/20-mp-host.png`);
      console.log(`shot: ${OUT}/21-mp-guest.png`);

      // The waiting state — what the player who is not to move sees.
      const waiting = guest.getByTestId('prompt-waiting');
      if ((await waiting.count()) > 0) {
        await guest.screenshot({ path: `${OUT}/22-mp-waiting.png` });
        console.log(`shot: ${OUT}/22-mp-waiting.png`);
      }
    } finally {
      await hostCtx.close().catch(() => undefined);
      await guestCtx.close().catch(() => undefined);
    }
  });
});
