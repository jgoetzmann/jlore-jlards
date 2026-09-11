/**
 * Latency probe: how long from a press to the screen changing.
 *
 *   npx playwright test e2e/latency.spec.ts
 *
 * Not an assertion suite. It clicks the way a player does (real pointer
 * events through Playwright) and times, inside the page, from the pointerdown
 * to the moment the DOM shows the result, then to the frame after it. Across
 * two browsers the watcher's clock is Date.now() on the same machine, so the
 * propagation number is honest to a millisecond or two.
 *
 * Rows print as `LATENCY {...}` and land in test-results/latency.json.
 * Excluded from `npm run e2e`: it measures, it does not gate.
 */

import { test, expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { mkdirSync, writeFileSync } from 'node:fs';

interface Row {
  scenario: string;
  step: string;
  seat?: string;
  turn?: number;
  domMs?: number;
  paintMs?: number;
  propagateMs?: number;
}

const rows: Row[] = [];
function record(row: Row): void {
  rows.push(row);
  console.log(`LATENCY ${JSON.stringify(row)}`);
}

test.afterAll(() => {
  mkdirSync('test-results', { recursive: true });
  writeFileSync('test-results/latency.json', JSON.stringify(rows, null, 2));
});

/**
 * Arm an observer on `watch` (its text, or `attr`), timed from the next
 * pointerdown anywhere in this page. Resolves {dom, paint} in ms.
 */
async function armSelf(page: Page, watch: string, attr: string | null): Promise<void> {
  await page.evaluate(
    ([watch, attr]) => {
      const w = window as unknown as Record<string, unknown>;
      const read = (): string | null => {
        const el = document.querySelector(watch as string);
        if (!el) return '__absent__';
        return attr ? el.getAttribute(attr as string) : el.textContent;
      };
      const before = read();
      w['__lat'] = new Promise((resolve) => {
        let t0: number | null = null;
        const onDown = (e: Event): void => {
          if (t0 === null) t0 = e.timeStamp;
        };
        document.addEventListener('pointerdown', onDown, true);
        const mo = new MutationObserver(() => {
          if (t0 === null || read() === before) return;
          const start = t0;
          const dom = performance.now() - start;
          mo.disconnect();
          document.removeEventListener('pointerdown', onDown, true);
          requestAnimationFrame(() =>
            requestAnimationFrame(() => resolve({ dom, paint: performance.now() - start })),
          );
        });
        mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      });
    },
    [watch, attr] as const,
  );
}

async function awaitSelf(page: Page, timeoutMs = 20_000): Promise<{ dom: number; paint: number }> {
  return page.evaluate(
    (timeoutMs) =>
      Promise.race([
        (window as unknown as Record<string, Promise<{ dom: number; paint: number }>>)['__lat']!,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('latency probe timed out')), timeoutMs)),
      ]),
    timeoutMs,
  );
}

/** Stamp Date.now() at the next pointerdown in the mover's page. */
async function armClickClock(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as Record<string, unknown>;
    w['__clickAt'] = null;
    document.addEventListener(
      'pointerdown',
      () => {
        if (w['__clickAt'] === null) w['__clickAt'] = Date.now();
      },
      { capture: true, once: true },
    );
  });
}

/** Resolve Date.now() when `watch` changes in the watcher's page. */
async function armWatcher(page: Page, watch: string, attr: string | null): Promise<void> {
  await page.evaluate(
    ([watch, attr]) => {
      const w = window as unknown as Record<string, unknown>;
      const read = (): string | null => {
        const el = document.querySelector(watch as string);
        if (!el) return '__absent__';
        return attr ? el.getAttribute(attr as string) : el.textContent;
      };
      const before = read();
      w['__seen'] = new Promise((resolve) => {
        const mo = new MutationObserver(() => {
          if (read() === before) return;
          mo.disconnect();
          resolve(Date.now());
        });
        mo.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true });
      });
    },
    [watch, attr] as const,
  );
}

async function propagation(mover: Page, watcher: Page, timeoutMs = 20_000): Promise<number> {
  const seen = await watcher.evaluate(
    (timeoutMs) =>
      Promise.race([
        (window as unknown as Record<string, Promise<number>>)['__seen']!,
        new Promise<never>((_, rej) => setTimeout(() => rej(new Error('watcher timed out')), timeoutMs)),
      ]),
    timeoutMs,
  );
  const clickAt = await mover.evaluate(() => (window as unknown as Record<string, number>)['__clickAt']!);
  return seen - clickAt;
}

async function clearPrompt(page: Page): Promise<boolean> {
  if ((await page.getByTestId('prompt').count()) === 0) return false;
  for (const id of ['prompt-default', 'prompt-option', 'prompt-confirm', 'prompt-skip']) {
    const el = page.getByTestId(id).first();
    if ((await el.count()) > 0 && (await el.isEnabled().catch(() => false))) {
      await el.click().catch(() => undefined);
      if (id !== 'prompt-option') return true;
    }
  }
  return true;
}

async function clearAll(page: Page): Promise<void> {
  for (let i = 0; i < 6; i += 1) if (!(await clearPrompt(page))) return;
}

async function focusSeatToMove(page: Page): Promise<void> {
  const toMove = page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]');
  if ((await toMove.count()) > 0) await toMove.first().click();
}

async function turnNumber(page: Page): Promise<number> {
  return Number((await page.getByTestId('turn-number').textContent())?.trim() ?? '0');
}

const MONEY = '[data-testid="stat-money-value"]';
const BUYS = '[data-testid="stat-buys-value"]';
const END = '[data-testid="end-turn"]';
const COPPER = '[data-testid="hand"] [data-card-id="copper"]';

/** One measured turn in hotseat: play up to 3 Coppers, buy a Copper, end the turn. */
async function measureHotseatTurn(page: Page, scenario: string): Promise<void> {
  await focusSeatToMove(page);
  await clearAll(page);
  const turn = await turnNumber(page);

  for (let i = 0; i < 3; i += 1) {
    const copper = page.locator(COPPER).first();
    if ((await copper.count()) === 0) break;
    await armSelf(page, MONEY, null);
    await copper.click();
    const t = await awaitSelf(page);
    record({ scenario, step: 'play-copper', turn, domMs: t.dom, paintMs: t.paint });
    await clearAll(page);
  }

  const pile = page.locator('[data-pile-id="resource:copper"][data-buyable="true"]');
  if ((await pile.count()) > 0) {
    await armSelf(page, BUYS, null);
    await pile.getByTestId('buy').click();
    const t = await awaitSelf(page);
    record({ scenario, step: 'buy', turn, domMs: t.dom, paintMs: t.paint });
    await clearAll(page);
  }

  const seatSel = '[data-testid="seat-btn"][data-seat-to-move="true"]';
  await armSelf(page, seatSel, 'data-seat');
  await page.locator(END).click();
  const t = await awaitSelf(page);
  record({ scenario, step: 'end-turn', turn, domMs: t.dom, paintMs: t.paint });
}

/** Burn turns quickly (end turn only) to reach the late game cheaply. */
async function skipTurns(page: Page, n: number): Promise<void> {
  for (let i = 0; i < n; i += 1) {
    await focusSeatToMove(page);
    await clearAll(page);
    const end = page.locator(END);
    if (!(await end.isEnabled().catch(() => false))) continue;
    const before = await page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]').first().getAttribute('data-seat');
    await end.click();
    await expect
      .poll(async () => page.locator('[data-testid="seat-btn"][data-seat-to-move="true"]').first().getAttribute('data-seat'))
      .not.toBe(before);
  }
}

test.describe('latency probe', () => {
  test('latency probe: hotseat, early and late game', async ({ page }) => {
    test.setTimeout(300_000);
    await page.goto('/#hotseat:2');
    await expect(page.getByTestId('table')).toBeVisible();

    await measureHotseatTurn(page, 'hotseat-early');
    await measureHotseatTurn(page, 'hotseat-early');
    await skipTurns(page, 30);
    await measureHotseatTurn(page, 'hotseat-late');
    await measureHotseatTurn(page, 'hotseat-late');
  });

  test('latency probe: two browsers over the dev relay', async ({ browser }) => {
    test.setTimeout(300_000);
    const open = async (b: Browser): Promise<{ ctx: BrowserContext; page: Page }> => {
      const ctx = await b.newContext();
      return { ctx, page: await ctx.newPage() };
    };
    const host = await open(browser);
    const guest = await open(browser);
    try {
      await host.page.goto('/');
      await host.page.getByTestId('create-room').click();
      await expect.poll(async () => new URL(host.page.url()).hash.replace(/^#/, '')).not.toBe('');
      const code = new URL(host.page.url()).hash.replace(/^#/, '');
      await expect(host.page.getByTestId('lobby')).toBeVisible({ timeout: 30_000 });
      await guest.page.goto(`/#${code}`);
      await expect(host.page.getByTestId('lobby-player')).toHaveCount(2, { timeout: 30_000 });
      await host.page.getByTestId('lobby-start').click();
      await expect(host.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });
      await expect(guest.page.getByTestId('table')).toBeVisible({ timeout: 30_000 });

      for (let round = 0; round < 4; round += 1) {
        // Whoever can end the turn is the mover.
        let mover = host;
        let watcher = guest;
        let role = 'host';
        await expect
          .poll(
            async () =>
              (await host.page.locator(END).isEnabled().catch(() => false)) ||
              (await guest.page.locator(END).isEnabled().catch(() => false)),
            { timeout: 30_000 },
          )
          .toBe(true);
        if (!(await host.page.locator(END).isEnabled().catch(() => false))) {
          mover = guest;
          watcher = host;
          role = 'guest';
        }
        await clearAll(mover.page);
        const turn = await turnNumber(mover.page);

        const copper = mover.page.locator(COPPER).first();
        if ((await copper.count()) > 0) {
          const oppSel = '[data-testid="opponent"]';
          await armSelf(mover.page, MONEY, null);
          await armClickClock(mover.page);
          await armWatcher(watcher.page, oppSel, 'data-hand-count');
          await copper.click();
          const self = await awaitSelf(mover.page);
          const prop = await propagation(mover.page, watcher.page);
          record({ scenario: 'relay', step: 'play-copper', seat: role, turn, domMs: self.dom, paintMs: self.paint, propagateMs: prop });
          await clearAll(mover.page);
        }

        await armSelf(mover.page, END, 'disabled');
        await armClickClock(mover.page);
        await armWatcher(watcher.page, END, 'disabled');
        await mover.page.locator(END).click();
        const self = await awaitSelf(mover.page);
        const prop = await propagation(mover.page, watcher.page);
        record({ scenario: 'relay', step: 'end-turn', seat: role, turn, domMs: self.dom, paintMs: self.paint, propagateMs: prop });
      }
    } finally {
      await host.ctx.close().catch(() => undefined);
      await guest.ctx.close().catch(() => undefined);
    }
  });
});
