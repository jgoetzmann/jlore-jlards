/**
 * Phones (375–430px wide), on a touch screen.
 *
 *   - no page is wider than the phone: start, lobby (host and guest), a 2- and
 *     4-seat hotseat table, the log drawer, the key sheet, the anomaly panel,
 *     prompts in all three placements (pile bar, pass chip, Discover panel),
 *     the motion fixture and game over, at 375x667, 390x844 and 430x932;
 *   - End turn, Play money, every Buy, prompt options and Confirm, and lobby
 *     Start are at least 44px tall and hit-testable once scrolled to;
 *   - text is legible without zooming: nothing under 11px, rules text 12px+;
 *   - hover-only affordances have a touch path: a long-press opens the card
 *     preview (and does not play the card), a disabled control's reason shows
 *     on tap, the reorder nudges are visible;
 *   - a real finger tap on a card lights the cards it references (links.ts)
 *     with no sheet over them; the same card again or empty table puts them
 *     out; a slide lights nothing; the sheet's Mentions chips light and scroll;
 *   - on touch, a tap on a Draft option picks it and a long press only reads it;
 *   - the premove bar in a two-browser room fits 390px.
 *
 * Overflow is measured against the configured viewport width, not innerWidth:
 * with mobile emulation a page that overflows widens its own layout viewport,
 * so `scrollWidth <= innerWidth` would pass on exactly the pages that fail.
 */

import { test, expect, type Browser, type Locator, type Page } from '@playwright/test';

const SIZES = [
  [375, 667],
  [390, 844],
  [430, 932],
] as const;

const TOUCH = { hasTouch: true, isMobile: true } as const;

async function focusSeatToMove(page: Page): Promise<void> {
  const toMove = page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]');
  if ((await toMove.count()) > 0) await toMove.first().click();
}

/** Null when the page fits `width`; otherwise what sticks out. */
async function overflow(page: Page, width: number): Promise<string | null> {
  return page.evaluate((w) => {
    const el = document.documentElement;
    if (el.scrollWidth <= w && innerWidth <= w) return null;
    const wide: string[] = [];
    for (const n of Array.from(document.querySelectorAll('body *'))) {
      const r = n.getBoundingClientRect();
      if (r.width > 0 && r.right > w + 1) wide.push(`${n.tagName.toLowerCase()}.${String(n.className).slice(0, 40)} ${Math.round(r.left)}–${Math.round(r.right)}`);
    }
    return `scrollWidth ${el.scrollWidth}, innerWidth ${innerWidth} > ${w}: ${wide.slice(0, 6).join('; ')}`;
  }, width);
}

/** Every element matching `selector`: at least 44px tall, and hit-testable once scrolled to. */
async function tappable(page: Page, selector: string): Promise<string[]> {
  return page.evaluate((sel) => {
    const bad: string[] = [];
    const els = Array.from(document.querySelectorAll<HTMLElement>(sel));
    if (els.length === 0) return [`${sel}: none rendered`];
    for (const el of els) {
      el.scrollIntoView({ block: 'center', inline: 'nearest' });
      const r = el.getBoundingClientRect();
      const label = `${sel} "${(el.textContent ?? '').trim().slice(0, 20)}"`;
      if (r.height < 44 - 0.5) bad.push(`${label} is ${Math.round(r.height)}px tall`);
      if (r.left < -0.5 || r.right > innerWidth + 0.5) bad.push(`${label} is clipped sideways: ${Math.round(r.left)}–${Math.round(r.right)}`);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      if (!hit || !(hit === el || el.contains(hit))) {
        bad.push(`${label} is covered by ${hit ? `${hit.tagName}.${String(hit.className)}` : 'nothing'}`);
      }
    }
    window.scrollTo(0, 0);
    return bad;
  }, selector);
}

/** Visible text under 11px anywhere, or card rules text under 12px. */
async function tinyText(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const bad: string[] = [];
    for (const n of Array.from(document.querySelectorAll<HTMLElement>('body *'))) {
      if (n.closest('[aria-hidden="true"], .motion-layer')) continue;
      const own = Array.from(n.childNodes).some((c) => c.nodeType === 3 && (c.textContent ?? '').trim() !== '');
      if (!own) continue;
      const cs = getComputedStyle(n);
      if (cs.display === 'none' || cs.visibility === 'hidden' || n.getClientRects().length === 0) continue;
      const size = parseFloat(cs.fontSize);
      const min = n.closest('.card-text') ? 12 : 11;
      if (size < min) bad.push(`${n.tagName.toLowerCase()}.${String(n.className)} "${(n.textContent ?? '').trim().slice(0, 16)}" ${size}px`);
    }
    return bad.slice(0, 10);
  });
}

/** A finger held down on the element's centre for `ms`. */
async function longPress(page: Page, selector: string, ms = 700): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box, `${selector} has a box`).not.toBeNull();
  const cdp = await page.context().newCDPSession(page);
  const x = box!.x + box!.width / 2;
  const y = box!.y + Math.min(box!.height / 2, 40);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  await page.waitForTimeout(ms);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** A real finger tap (touchStart + touchEnd) on the element's centre, never a synthetic DOM event. */
async function fingerTap(page: Page, target: Locator): Promise<void> {
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box, 'tap target has a box').not.toBeNull();
  await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + Math.min(box!.height / 2, 40));
}

/** A finger that goes down on the element and slides `dy` px up, the way a scroll starts. */
async function fingerSlide(page: Page, selector: string, dy: number): Promise<void> {
  const target = page.locator(selector).first();
  await target.scrollIntoViewIfNeeded();
  const box = await target.boundingBox();
  expect(box, `${selector} has a box`).not.toBeNull();
  const x = box!.x + box!.width / 2;
  const y = box!.y + box!.height / 2;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchStart', touchPoints: [{ x, y }] });
  for (let i = 1; i <= 8; i++) {
    await cdp.send('Input.dispatchTouchEvent', { type: 'touchMove', touchPoints: [{ x, y: y - (dy * i) / 8 }] });
    await page.waitForTimeout(16);
  }
  await cdp.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  await cdp.detach();
}

/** The first match is on screen and its centre hit-tests to itself (no sheet or layer over it). */
async function uncovered(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return false;
    const r = el.getBoundingClientRect();
    if (r.bottom <= 0 || r.top >= innerHeight) return false;
    const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
    return hit !== null && (hit === el || el.contains(hit));
  }, selector);
}

/** A fresh document for each screen, so one page's layout can't leak into the next. */
async function open(page: Page, hash: string): Promise<void> {
  await page.goto('about:blank');
  await page.goto(`/${hash}`);
}

async function lobbyPair(browser: Browser, width: number, height: number) {
  const opts = { viewport: { width, height }, ...TOUCH };
  const hostCtx = await browser.newContext(opts);
  const host = await hostCtx.newPage();
  await host.goto('/');
  await host.getByTestId('create-room').click();
  await expect(host.getByTestId('lobby-start')).toBeVisible();
  const code = ((await host.getByTestId('lobby-code').textContent()) ?? '').trim();
  const guestCtx = await browser.newContext(opts);
  const guest = await guestCtx.newPage();
  await guest.goto(`/#${code}`);
  await expect(guest.getByTestId('lobby-waiting')).toBeVisible();
  await expect(host.getByTestId('lobby-player')).toHaveCount(2);
  return {
    host,
    guest,
    close: async () => {
      await guestCtx.close();
      await hostCtx.close();
    },
  };
}

for (const [width, height] of SIZES) {
  test.describe(`phone ${width}x${height}`, () => {
    test.use({ viewport: { width, height }, ...TOUCH });

    test('no page is wider than the phone', async ({ page, browser }) => {
      const failures: string[] = [];
      const check = async (name: string): Promise<void> => {
        const o = await overflow(page, width);
        if (o) failures.push(`${name}: ${o}`);
      };

      await open(page, '');
      await expect(page.getByTestId('create-room')).toBeVisible();
      await check('start');

      for (const seats of [2, 4]) {
        await open(page, `#hotseat:${seats}`);
        await expect(page.getByTestId('table')).toBeVisible();
        await focusSeatToMove(page);
        await expect(page.getByTestId('hand').getByTestId('card').first()).toBeVisible();
        await check(`hotseat ${seats}`);
      }

      await page.getByTestId('drawer-toggle').click();
      await expect(page.getByTestId('drawer')).toBeVisible();
      await expect(page.getByTestId('log')).toBeVisible();
      await check('hotseat 4, drawer open');

      await page.getByTestId('key-help-toggle').click();
      await expect(page.getByTestId('key-help')).toBeVisible();
      await check('key sheet');

      await open(page, '#fixture:pile-pick');
      await expect(page.getByTestId('prompt')).toHaveAttribute('data-placement', 'board');
      await check('pile prompt bar');

      await open(page, '#fixture:pass');
      await expect(page.getByTestId('prompt-waiting')).toBeVisible();
      await check('pass chip');
      await page.getByTestId('prompt-pass').click();
      await expect(page.getByTestId('prompt')).toHaveAttribute('data-placement', 'panel');
      await check('choose panel');

      await open(page, '#fixture:discover');
      await expect(page.getByTestId('prompt')).toHaveAttribute('data-prompt-type', 'discover');
      await check('Discover panel');

      await open(page, '#fixture:motion');
      await page.getByTestId('opponent').first().click();
      await expect(page.getByTestId('seat-detail')).toBeVisible();
      await page.getByTestId('fixture-step').click();
      await check('motion step, seat open');

      await open(page, '#fixture:anomaly');
      await page.getByTestId('anomaly-banner').click();
      await expect(page.getByTestId('anomaly-panel')).toBeVisible();
      await check('anomaly panel');

      await open(page, '#fixture:game-over');
      await expect(page.getByTestId('game-over')).toBeVisible();
      await check('game over');

      const lobby = await lobbyPair(browser, width, height);
      for (const [name, p] of [
        ['lobby host', lobby.host],
        ['lobby guest', lobby.guest],
      ] as const) {
        const o = await overflow(p, width);
        if (o) failures.push(`${name}: ${o}`);
      }
      await lobby.close();

      expect(failures, failures.join('\n')).toHaveLength(0);
    });
  });
}

test.describe('phone 390x844, touch', () => {
  test.use({ viewport: { width: 390, height: 844 }, ...TOUCH });

  test('primary controls are 44px and reachable; text is legible', async ({ page, browser }) => {
    await page.goto('/#hotseat:2');
    await expect(page.getByTestId('table')).toBeVisible();
    await focusSeatToMove(page);
    await expect(page.getByTestId('hand').getByTestId('card').first()).toBeVisible();

    for (const sel of ['[data-testid="end-turn"]', '[data-testid="play-money"]', '[data-testid="buy"]']) {
      const bad = await tappable(page, sel);
      expect(bad, bad.join('\n')).toHaveLength(0);
    }
    let tiny = await tinyText(page);
    expect(tiny, tiny.join('\n')).toHaveLength(0);

    // Touch has no hover, so the reorder nudges are simply there on your turn.
    const nudge = page.locator('.hand-nudge').first();
    await expect(nudge).toBeVisible();
    expect(await nudge.evaluate((el) => getComputedStyle(el).opacity)).toBe('1');

    // A played card still plays with a tap.
    const copper = page.getByTestId('hand').locator('[data-card-id="copper"]').first();
    if ((await copper.count()) > 0) {
      const before = await page.getByTestId('hand').getByTestId('card').count();
      await copper.tap();
      await expect.poll(async () => page.getByTestId('hand').getByTestId('card').count()).toBeLessThan(before);
    }

    await page.goto('/#fixture:pile-pick');
    await expect(page.getByTestId('prompt-confirm')).toBeVisible();
    for (const sel of ['[data-testid="prompt"] [data-testid="prompt-option"]', '[data-testid="prompt-confirm"]']) {
      const bad = await tappable(page, sel);
      expect(bad, bad.join('\n')).toHaveLength(0);
    }
    await page.getByTestId('prompt-option').first().tap();
    await expect(page.getByTestId('prompt-confirm')).toBeEnabled();
    await page.getByTestId('prompt-confirm').tap();
    await expect(page.getByTestId('prompt')).toHaveCount(0);

    await page.goto('/#fixture:discover');
    await expect(page.getByTestId('prompt-option')).toHaveCount(3);
    const optionsBad = await tappable(page, '[data-testid="prompt-option"]');
    expect(optionsBad, optionsBad.join('\n')).toHaveLength(0);
    tiny = await tinyText(page);
    expect(tiny, tiny.join('\n')).toHaveLength(0);
    const option = page.getByTestId('prompt-option').nth(2);
    const key = await option.getAttribute('data-option-key');
    await option.tap();
    await expect(page.getByTestId('prompt')).toHaveCount(0);
    const last = await page.evaluate(() => (window as unknown as { __fixtureSent?: unknown[] }).__fixtureSent?.at(-1));
    expect(last).toMatchObject({ type: 'resolve', promptId: 'fx-discover', keys: [key] });

    const lobby = await lobbyPair(browser, 390, 844);
    const startBad = await tappable(lobby.host, '[data-testid="lobby-start"]');
    expect(startBad, startBad.join('\n')).toHaveLength(0);
    tiny = await tinyText(lobby.host);
    expect(tiny, tiny.join('\n')).toHaveLength(0);
    await lobby.close();
  });

  test('a long-press opens the card preview and does not play the card', async ({ page }) => {
    await page.goto('/#hotseat:2');
    await expect(page.getByTestId('table')).toBeVisible();
    await focusSeatToMove(page);
    const cards = page.getByTestId('hand').getByTestId('card');
    await expect(cards.first()).toBeVisible();
    const before = await cards.count();
    const name = await cards.first().getAttribute('data-card-name');

    await longPress(page, '[data-testid="hand"] [data-testid="card"]');
    const sheet = page.getByTestId('card-preview-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('card-preview')).toHaveAttribute('data-card-name', name ?? '');
    await page.waitForTimeout(300);
    await expect(cards).toHaveCount(before);
    await expect(sheet).toBeVisible();

    const close = page.getByTestId('card-preview-close');
    const box = await close.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    await close.tap();
    await expect(sheet).toHaveCount(0);
    await expect(cards).toHaveCount(before);
  });

  test('a tap lights the cards a card references, with nothing covering them', async ({ page }) => {
    await page.goto('/#fixture:links');
    await expect(page.getByTestId('table')).toBeVisible();
    const STASH = '[data-testid="in-play"] [data-card-id="silver_stash"]';
    const stash = page.locator(STASH);
    const silver = page.locator('[data-testid="pile"] [data-testid="card"][data-card-id="silver"]');
    const discardTop = page.locator('.dock-discard-top');
    const sheet = page.getByTestId('card-preview-sheet');
    await expect(stash).toBeVisible();
    await expect(silver).not.toHaveClass(/card-linked/);

    // A real finger tap: the references light and no sheet covers the table.
    await fingerTap(page, stash);
    await expect(silver).toHaveClass(/card-linked/);
    await expect(sheet).toHaveCount(0);
    // The dock's discard top (a Silver in this fixture) lights too (MOB-6).
    await expect(discardTop).toHaveClass(/card-linked/);
    // Nothing unrelated lights up.
    await expect(page.locator('[data-testid="pile"] [data-card-id="gold"]')).not.toHaveClass(/card-linked/);
    // And the lit face can be seen: on screen and not under anything.
    await silver.scrollIntoViewIfNeeded();
    expect(await uncovered(page, '[data-testid="pile"] [data-testid="card"][data-card-id="silver"]')).toBe(true);

    // The same card again puts them out.
    await fingerTap(page, stash);
    await expect(silver).not.toHaveClass(/card-linked/);
    await expect(sheet).toHaveCount(0);

    // A tap on empty table puts them out.
    await fingerTap(page, stash);
    await expect(silver).toHaveClass(/card-linked/);
    await page.locator('.brand').tap();
    await expect(silver).not.toHaveClass(/card-linked/);

    // A slide that starts on the card is a scroll: it lights nothing (MOB-2).
    await fingerSlide(page, STASH, 80);
    await page.waitForTimeout(200);
    await expect(silver).not.toHaveClass(/card-linked/);
    await expect(sheet).toHaveCount(0);

    // A long press opens the sheet; closing it keeps the highlight a tap set.
    await fingerTap(page, stash);
    await expect(silver).toHaveClass(/card-linked/);
    await longPress(page, STASH);
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('card-preview')).toHaveAttribute('data-card-id', 'silver_stash');
    await page.getByTestId('card-preview-close').tap();
    await expect(sheet).toHaveCount(0);
    await expect(silver).toHaveClass(/card-linked/);

    // A Mentions chip closes the sheet, lights the links and shows the face.
    await page.locator('.brand').tap();
    await expect(silver).not.toHaveClass(/card-linked/);
    await longPress(page, STASH);
    await expect(sheet).toBeVisible();
    // Scroll the table behind the sheet so the Silver face is off screen.
    await page.evaluate(() => {
      const el = document.querySelector('[data-testid="pile"] [data-card-id="silver"]')!;
      const r = el.getBoundingClientRect();
      window.scrollBy(0, r.top < innerHeight / 2 ? r.bottom + innerHeight : r.top - innerHeight * 2);
    });
    const chip = sheet.getByTestId('card-link').filter({ hasText: 'Silver' });
    await expect(chip).toBeVisible();
    await chip.tap();
    await expect(sheet).toHaveCount(0);
    await expect(silver).toHaveClass(/card-linked/);
    await expect
      .poll(() =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll('[data-card-id="silver"]')).some((el) => {
            const r = el.getBoundingClientRect();
            return r.height > 0 && r.bottom > 0 && r.top < innerHeight;
          }),
        ),
      )
      .toBe(true);
  });

  test('a tap on a Draft option picks it; a long press opens it and does not pick', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.goto('/');
    await page.getByTestId('create-room').tap();
    await expect(page.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });
    const box = page.getByTestId('lobby-draft');
    await box.tap();
    await expect(box).toHaveAttribute('data-on', 'true');
    await page.getByTestId('lobby-start').tap();
    await expect(page.getByTestId('draft-panel')).toBeVisible({ timeout: 30_000 });

    const panel = page.getByTestId('draft-panel');
    const progress = page.getByTestId('draft-progress');
    const slot = async (): Promise<string> =>
      (await panel.count()) === 0 ? 'gone' : `${await panel.getAttribute('data-slot-kind')}:${await panel.getAttribute('data-slot')}`;
    const first = await slot();
    const before = (await progress.textContent()) ?? '';
    await expect(page.getByTestId('draft-option')).toHaveCount(4);

    // Long press on a face: the sheet opens and nothing is picked.
    const def = await page.getByTestId('draft-option').first().getAttribute('data-option-def');
    await longPress(page, '[data-testid="draft-option"] [data-card-id]');
    const sheet = page.getByTestId('card-preview-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('card-preview')).toHaveAttribute('data-card-id', def ?? '');
    await page.waitForTimeout(400);
    expect(await slot()).toBe(first);
    await expect(progress).toHaveText(before);
    await page.getByTestId('card-preview-close').tap();
    await expect(sheet).toHaveCount(0);
    expect(await slot()).toBe(first);
    await expect(progress).toHaveText(before);

    // A tap picks.
    await fingerTap(page, page.getByTestId('draft-option').nth(1));
    await expect.poll(slot).not.toBe(first);
    await expect(progress).not.toHaveText(before);
    expect(errors, errors.join(' | ')).toHaveLength(0);
  });

  test('the premove bar fits a 390px screen in a two-browser room', async ({ browser }) => {
    test.setTimeout(240_000);
    const lobby = await lobbyPair(browser, 390, 844);
    try {
      await lobby.host.getByTestId('lobby-start').tap();
      await expect(lobby.host.getByTestId('table')).toBeVisible({ timeout: 30_000 });
      await expect(lobby.guest.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      let waiter: Page | null = null;
      await expect
        .poll(
          async () => {
            const h = await lobby.host.getByTestId('end-turn').isEnabled();
            const g = await lobby.guest.getByTestId('end-turn').isEnabled();
            waiter = h && !g ? lobby.guest : g && !h ? lobby.host : null;
            return waiter !== null;
          },
          { timeout: 30_000, message: 'exactly one browser should hold the turn' },
        )
        .toBe(true);
      const page = waiter as unknown as Page;

      const failures: string[] = [];
      const check = async (name: string, ids: string[]): Promise<void> => {
        for (const id of ids) {
          const b = await page.getByTestId(id).boundingBox();
          if (!b) failures.push(`${name}: ${id} has no box`);
          else if (b.x < -0.5 || b.x + b.width > 390.5) failures.push(`${name}: ${id} spans ${Math.round(b.x)}–${Math.round(b.x + b.width)}`);
        }
        const o = await overflow(page, 390);
        if (o) failures.push(`${name}: ${o}`);
      };

      const toggle = page.getByTestId('premove-toggle');
      await expect(toggle).toBeEnabled({ timeout: 20_000 });
      await toggle.scrollIntoViewIfNeeded();
      await check('toggle', ['premove-toggle']);

      await toggle.tap();
      await expect(page.getByTestId('premove-bar')).toBeVisible();
      await expect(page.getByTestId('premove-live')).toBeVisible();
      await expect(page.getByTestId('premove-clear')).toBeVisible();
      await check('bar, nothing queued', ['premove-bar', 'premove-live', 'premove-clear']);

      const card = page
        .getByTestId('hand')
        .locator('[data-testid="card"][data-card-id="copper"], [data-testid="card"][data-clickable="true"]')
        .first();
      await expect(card).toBeVisible({ timeout: 20_000 });
      await fingerTap(page, card);
      await expect(page.getByTestId('premove-bar')).toHaveAttribute('data-count', '1');
      await check('bar, one queued', ['premove-bar', 'premove-live', 'premove-clear']);

      expect(failures, failures.join('\n')).toHaveLength(0);
    } finally {
      await lobby.close();
    }
  });

  test('a disabled control says why on tap', async ({ page }) => {
    await page.goto('/#hotseat:2');
    await expect(page.getByTestId('table')).toBeVisible();
    await focusSeatToMove(page);
    const disabled = page.locator('[data-testid="buy"]:disabled').first();
    await expect(disabled).toHaveCount(1);
    const reason = await disabled.getAttribute('title');
    expect(reason).toBeTruthy();
    await disabled.scrollIntoViewIfNeeded();
    const box = await disabled.boundingBox();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(page.getByTestId('tap-tip')).toHaveText(reason!);
    const tip = await page.getByTestId('tap-tip').boundingBox();
    expect(tip!.x).toBeGreaterThanOrEqual(0);
    expect(tip!.x + tip!.width).toBeLessThanOrEqual(390);
  });
});
