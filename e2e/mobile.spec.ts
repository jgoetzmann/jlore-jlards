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
 *     preview (and does not play the card), a tap on a card with no action opens
 *     it too, a disabled control's reason shows on tap, the reorder nudges are
 *     visible;
 *   - tapping a card lights the cards it references (links.ts).
 *
 * Overflow is measured against the configured viewport width, not innerWidth:
 * with mobile emulation a page that overflows widens its own layout viewport,
 * so `scrollWidth <= innerWidth` would pass on exactly the pages that fail.
 */

import { test, expect, type Browser, type Page } from '@playwright/test';

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

  test('a tap on a card with no action opens it, and lights the cards it references', async ({ page }) => {
    await page.goto('/#fixture:links');
    await expect(page.getByTestId('table')).toBeVisible();
    const stash = page.getByTestId('in-play').locator('[data-card-id="silver_stash"]');
    const silver = page.locator('[data-testid="pile"] [data-testid="card"][data-card-id="silver"]');
    await expect(stash).toBeVisible();
    await expect(silver).not.toHaveClass(/card-linked/);

    await stash.tap();
    await expect(silver).toHaveClass(/card-linked/);
    const sheet = page.getByTestId('card-preview-sheet');
    await expect(sheet).toBeVisible();
    await expect(sheet.getByTestId('card-links')).toContainText('Silver');
    // Nothing unrelated lights up.
    await expect(page.locator('[data-testid="pile"] [data-card-id="gold"]')).not.toHaveClass(/card-linked/);

    // Closing the sheet clears the highlight.
    await page.getByTestId('card-preview-close').tap();
    await expect(sheet).toHaveCount(0);
    await expect(silver).not.toHaveClass(/card-linked/);

    // A tap on a card that does have an action lights its links too, and a
    // tap somewhere that is not a card clears them.
    await stash.scrollIntoViewIfNeeded();
    const box = await stash.boundingBox();
    await page.touchscreen.tap(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await expect(silver).toHaveClass(/card-linked/);
    await page.getByTestId('card-preview-close').tap();
    await stash.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
    await expect(silver).toHaveClass(/card-linked/);
    await page.locator('.brand').tap();
    await expect(silver).not.toHaveClass(/card-linked/);
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
