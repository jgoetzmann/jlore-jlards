# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Jlore Jlards is a browser deck-builder (Dominion lineage) for 2–4 friends. Every browser runs the same pure rules engine in lockstep over one ordered message list per room (SB-65). The backend is a relay that parses nothing about the game: a Redis list plus pub/sub, pushed to browsers as server-sent events. TypeScript strict, React 18, Vite, Vitest, Playwright. Node 20+.

## Commands

```bash
npm run dev                 # http://localhost:5173; the relay middleware is mounted, so two browser profiles can play multiplayer locally with no Upstash (one profile shares the jlore_seat cookie, so use e.g. a normal and a private window)
npm test                    # vitest run (test/**/*.test.ts). Node environment, no DOM: UI tests use renderToStaticMarkup or pure functions. To cap workers pass --maxWorkers=N --minWorkers=1 (--maxWorkers alone errors)
npx vitest run test/core-view.test.ts      # one file
npx vitest run -t "B111"                   # tests whose name matches
npm run typecheck           # tsc --noEmit over src, test, tools, api. e2e/ is outside tsconfig, so spec types are never checked
npm run build               # typecheck + vite build
npm run cards:validate      # catalog integrity. Run it after touching src/cards/
npm run e2e                 # Playwright/Chromium on :5199 (E2E_PORT=… moves it), serial; skips the "visual record", "production smoke" and "latency probe" suites
npx playwright test e2e/hotseat.spec.ts    # one e2e spec
npm run sim -- --games=25 --players=2 --seed=1          # headless bot matches
npm run balance -- --games=500 --players=3 --seed=1     # bot matches -> telemetry/balance-<stamp>.md
npm run replay -- --seed=42 --players=3 --out=telemetry/bug.json   # bot match; record its action log
npm run replay -- --in=telemetry/bug.json --turn=14                # replay a recording, stop at the start of a turn
npm run relay:check         # hit the real Upstash backend using .env credentials (append, since=end, TTL, and the pub/sub push path)
npm run latency             # e2e/latency.spec.ts: press-to-render times in hotseat and across two browsers; rows land in test-results/latency.json
```

Without `--in` or `--turn`, `replay` replays the recorded log twice and exits 1 if the two results differ. That checks that replay is self-consistent. It does not compare against the original bot run.

Not in CI:
- `npm run shots` (`e2e/screenshots.spec.ts`) plays up to 26 turns, takes about 15 minutes, and writes PNGs into `shots/`.
- `npm run smoke` (`e2e/smoke.spec.ts`) runs against the live deployment (`SMOKE_URL=…` for a preview). It is the only check that catches a deploy missing its Upstash vars.
- `art:generate` and `art:status` are described under Cards.

A bare `npx playwright test` with no file also runs shots and smoke. Playwright always starts its own `vite --strictPort` on `E2E_PORT` (default 5199), so if a server is already on that port the run fails.

CI (`.github/workflows/ci.yml`) runs typecheck, test, cards:validate, a 25-game sim smoke run, and e2e. Treat all five as the bar. There is no ESLint or Prettier. `tsc` is the only static check.

## Architecture

```
src/engine/  pure rules engine: reduce(state, action) -> state
src/cards/   the catalog (~535 CardDefinitions + 25 auras) as typed TS data
src/net/     lockstep session (every browser runs reduce), relay transport (SSE + polling fallback), lobby host, storage tiers
src/relay/   relay request logic (roomHandler, streamRoom), the fetch-based Upstash REST adapter, Vite dev middleware
api/room/[code].ts   Vercel function: a thin wrapper over src/relay/roomHandler
src/ui/      React app. Hash routes: '' start, #hotseat[:N], #ROOMCODE (lobby first, then the table), dev-only #fixture:<name>
src/sim/     bots, headless runner, telemetry (no fs or clock; the tools/ CLIs do that)
tools/       tsx CLIs (plus art_render.py, the Python renderer behind art:generate); tools/bootstrap.ts fills the registry and parses --flags
```

Path aliases `@engine/*`, `@cards/*`, `@net/*`, `@ui/*`, `@sim/*` are set in three places: tsconfig, vite.config, and vitest.config. If you add or change one, change all three. The exception is `api/room/[code].ts` and what it imports at runtime (`src/relay/roomHandler.ts`, `src/relay/upstash.ts`). Vercel runs those as plain Node ESM, not through Vite, so they need relative imports with explicit `.js` extensions and never the aliases. Dev and e2e serve the relay through Vite middleware, so only `npm run smoke` catches a mistake there.

### Engine invariants

B117–B119 and "reject leaves state unchanged" are tested. The import boundary, the console ban and synchronicity are convention only.

- **Import boundary:** `src/engine/` never imports from `net/`, `ui/`, `sim/`, or `api/`. The one allowed exception is `registry.ts`, which imports `@cards/index` so it can lazily bootstrap the catalog on first access. No test checks this.
- **Determinism (B117):** no `Math.random`, `Date.now`, or `new Date` anywhere under `src/engine/`. The test does a plain **substring search of file contents**, so comments count too. All randomness comes from `state.seed` + `state.rngCursor` (`rng.ts`, SB-31). There is no shared generator. Each randomness site calls `makeRng(s.seed, s.rngCursor)`, draws, then writes `s.rngCursor = rng.cursor()` back onto the draft. Forget the write-back and the next draw repeats. B119 still passes when that happens, so no test catches it. Pure reads (`costOf`, `legalActions`, rendering) must not advance the cursor. Derive a throwaway stream instead, as `shop/dynamic.ts` does. Because every browser runs `reduce` in lockstep (SB-65), results must also be identical across JS engines. Don't use implementation-approximated `Math` functions (`log`, `pow`, `exp`, trig) under `src/engine/`. `expr.ts`'s `log` is built from exactly-rounded operations for this reason (`test/effects-expr-determinism.test.ts`).
- **`reduce` never throws.** It deep-clones the input once at entry with the hand-rolled `core/clone.ts`, not `structuredClone`. So `GameState` must stay plain JSON: a `Map`, `Set`, or class instance becomes a plain object after the first `reduce`, so use records keyed by id. `cloneState` copies the log array but shares its `LogEntry` objects, so never mutate a `LogEntry` (or its `detail`) on a state `reduce` returned. `core/log.ts` `makeLogEntry` deep-copies `detail` when an entry is created, so entries own their data. Helpers below `reduce` may mutate that draft freely (Addendum A5). An illegal action returns the state unchanged with a reject `LogEntry` appended, and every branch appends at least one log entry (B118). Throws below `reduce` are contained, not forbidden:
  - `getCard`/`getAura` throw on unknown ids. Systems code uses `tryGetCard`.
  - `expr.ts` throws `ExprError`. `evalAmount` maps it to 0 and `evalCondition` to false.
  - `reduce` turns any other exception into a reject with reason `engineError`. If an action silently does nothing, look for that in `state.log`, not the console.

  Never use `console` for game events, and never implement a rules outcome with a throw.
- **Replay (B119):** re-running `createMatch` plus the logged actions must reproduce the exact state. This is what `npm run replay` relies on.
- **The engine is fully synchronous.** Async code and I/O live in `net/`, `src/relay/`, `api/`, and the tools/ CLIs.

### Core engine mechanics (these span several files)

- **Card identity has three levels:** `CardDefinition` (the printed card, in the registry) → per-match variant overrides (Buff/Nerf, elements) → `CardInstance`. Instances live in a central `state.instances` registry, and each records its own `zone`. Player library/hand/gy/play and shop piles hold ordered `InstanceId[]`. There is no trash or aside array: readers scan `state.instances` by zone (`core/zones.ts` `zoneList` returns null for those zones). `field` holds `AuraInstance[]` (SB-32).
- **Effects are a typed node tree** interpreted by `src/engine/effects/index.ts`. The 55 ops are dispatched from `applyNode`, and implementations live in `effects/ops/*.ts`. Nodes resolve FIFO off a queue, never the JS call stack. Hard limits: `config.effectNodeBudget` nodes per turn, `config.recursionDepth` nesting, and `PROMPT_BUDGET_PER_TURN` (60) in `core/resume.ts` for prompt chains. Hitting any limit fizzles and logs; it never hangs or throws. An unknown op is logged and skipped, so a missing `applyNode` case still compiles.
- **`{ifPrevious: true}` is inferred from the log.** `runQueue` marks the next queued node as "previous did something" if `state.logSeq` grew while the previous node ran. An op that changes state must log it, or any `ifPrevious` after it reads false.
- **Two `triggers.ts` files.** `core/` code enters the interpreter through `core/triggers.ts` `runEffects`, which adds the depth and budget gates and a try/catch. Meta, systems and effects code call `resolveEffects` directly, so only `reduce`'s catch covers them. Inside ops, trash, discard and shuffle go through the `effects/triggers.ts` wrappers (`trashWithTrigger`, `discardWithTrigger`, `shuffleWithTrigger`, `fireEvent`), which queue triggers behind the current queue. `onWouldTrash` is the exception and resolves immediately. `core/zones.ts` moves cards without firing anything.
- **Prompts are state:** an op that needs a choice sets `state.pending` and parks the rest of the queue on `state.queue`. The answer comes back as a `resolve` action and `core/resume.ts` continues from there. While `pending` is set, `reduce` rejects every other action type.
- **Expression strings** (`"floor(uniqueCardsInDeck / 3)"`) go through the recursive-descent evaluator in `engine/expr.ts`. It knows the frozen `EXPR_VARS` list plus what the context supplies: loop vars like `x`, and every player counter by its key, with any `turn:` prefix dropped (`effects/context.ts` `buildVars`). No `eval`. At the table a bad expression reads 0 or false. Every `count(x)`/`countIn(zone, x)` name must be in `NAMED_FILTERS` (`effects/select.ts`): an unknown name silently reads 0. `cards:validate` and the SB-52 test in `test/audit-regressions.test.ts` catch it.
- **Shop (`src/engine/shop/`).** A match offers `config.prophetPileCount` Prophet piles (default 4), sampled one per threshold band from `PROPHET_SHOP_CARD_IDS` in `shop/prophet.ts`. Prophet buys cost no Money and no Buy. They need `threshold` Prophet banked, then drain `cost.prophet.drain`. A price that reads live state goes in `DYNAMIC_PRICES` (`shop/dynamic.ts`) and must be pure, because `costOf` also runs during rendering and in `legalActions`.
- **`src/engine/types.ts` is the shared type surface.** Its header calls it frozen, but new fields and ops are added there. It imports nothing. By convention (not a test), no other file redeclares a name that appears in it.

### Hidden information (waived for playtesting, SB-65)

Every browser holds the full `GameState`: every hand, every library in draw order, and the seed and RNG cursor. The relay list, readable by anyone with the room code, carries every action. The one boundary kept is the UI: React is only ever handed a `GameView` from `engine/view.ts` `viewFor(state, player)`, so the table never renders another player's hand. B111 (restated in `test/net-host.test.ts`) and the hidden-hand DOM test in `e2e/multiplayer.spec.ts` pin that. In a `GameView`, libraries (including your own) and opponents' hands are counts, and a pending prompt's options go only to its chooser.

- `you.vp` and `others[].vp` are the live score. You get `liveVp`, and opponents get `publicVp`, which is the live score minus `secret` VP. That is the same `scoreFor` the win conditions read. `player.vp` in state holds only effect-granted VP.
- The log scrub in `viewFor` replaces hidden instance ids and blanks `defId` on entries that mention one. Anything else you log reaches every seat's screen.

### Networking (lockstep, SB-65)

Messages use the envelope `{seq, from, to?, kind: 'intent'|'view'|'hello'|'snapshot', payload}` (the four kinds are frozen) and ride one Redis list per room (`jlore:room:CODE`, 6h TTL). `seq` is the list index, and that order is the one total order every browser applies. The code is `src/net/lockstep.ts` (`LockstepCore`, `startSession`) wired through `src/ui/useGame.ts`.

- **Start.** After the lobby, the host posts one `snapshot` tagged `jlore-start/1`. It carries the config, the seed, each seat's name and codex, the seat bindings (`seats[i]` acts for `playerOrder[i]`) and a checksum. Every browser builds the identical match from it (`makeStart`/`buildStartState`). The first start in a room is the match.
- **Actions.** An intent is `{nonce, actions}`. The acting player comes from the envelope's `from` through the seat bindings, never from the payload. `applyActions` unrolls a batch in order (at most `MAX_BATCH` 64) and stops at the first refused action or the first prompt. There is no legality pre-gate: `reduce` refuses illegal actions identically on every client.
- **Optimistic apply.** `session.send` and `sendMany` reduce onto the predicted state and render before posting. A client's posts leave in click order, and an in-order echo is adopted without a second `reduce`. If a foreign intent lands first, the pending actions are refolded onto it. So anything that feeds `reduce` must be deterministic across browsers (see Engine invariants).
- **Desync safety net.** At each turn boundary the host's seat posts a `jlore-check/1` checksum (`stateChecksum`: key-sorted, log body excluded). A client that disagrees first rebuilds from the start plus the intent list. If that still disagrees, it asks with `jlore-resync/1` and adopts a `jlore-state/1` reply. `session.desynced` is true meanwhile.
- **A reload is a rejoin.** A browser reads the room from index 0 and replays it. The token in the `jlore_seat` cookie is the `from` of every client message, so it binds the browser back to its seat, the host included. A replaying client holds its own posts until it has read up to `?since=end`. Whether `#CODE` opens the lobby as host or joins is decided per tab (sessionStorage `jlore_open_lobbies`). After the deal every browser runs the same session.
- **Hotseat** runs the same session over `makeLocalRelay()`, acting for every seat. It follows the prompt's owner before the active seat, and a seat picked by hand holds only until the turn or prompt changes.
- **Lobby (SB-64)** is still host-driven (`startLobbyHost`):
  - `hello` heartbeats every 4s, and a seat is dropped after 20s of silence.
  - The roster is a broadcast `view` carrying a `LobbyPayload`. `isLobbyPayload` and the client's `isView` must stay mutually exclusive (`test/net-lobby.test.ts`).
  - The app no longer uses the old per-seat-view `startHost`/`startClient`. They are kept because the lobby tests drive them.
- **Transport** (`src/net/relay.ts`, `src/relay/roomHandler.ts`). `GET /api/room/CODE?stream=1&since=N` is server-sent events, one event per list entry.
  - In production a POST is one Upstash `/pipeline` call (RPUSH + EXPIRE + PUBLISH), and each open stream SUBSCRIBEs over REST. That goes through `src/relay/upstash.ts`, a fetch adapter shared by the function, the dev middleware and `relay:check`. `@upstash/redis` is no longer imported.
  - A stream ends itself after ~50s (`STREAM_MAX_MS`) to fit `maxDuration: 60`, and the client reopens from its cursor.
  - If a stream can't open, shows no first byte within 4s, or fails 3 times, the client polls: every 1s at rest and every 250ms for 5s after traffic. Every request has a timeout (4s GET, 8s POST).
  - Whether Vercel streams `res.write` unbuffered is unverified until a deploy. If it buffers, clients fall back to polling without any error.
- **Budget.** SB-65 estimates ~6,500 Upstash commands and ~1,100 Vercel invocations per 4-player hour on the push path, and ~15-20k commands if everyone falls back to polling. The free tier is 500k commands a month, so check the Upstash console after a real session.
- **The memory-fallback trap.** The relay falls back to an in-memory store when the Upstash vars are missing or unusable. That's why e2e and dev need no credentials, and why a green test suite proves nothing about the live backend. On Vercel it silently breaks multiplayer, because serverless instances don't share memory, yet every request still returns 200. Diagnose it three ways:
  - the `x-jlore-store: redis|memory` response header, which says which store answered
  - `relay:check`, which checks the credentials and the push path
  - `npm run smoke`, which checks the deployment

  Use the Upstash **REST** URL (`https://…`), not the `redis://` one.

### Cards

To add a card, add a `CardDefinition` to the right file under `src/cards/<group>/`. Each group's barrel exports `cards`, and `src/cards/index.ts` concatenates them. A Draft Shop card needs no engine changes unless it needs a new effect op, because `draftCandidates` (`engine/shop/build.ts`) picks up any purchasable, money-priced, non-basic, non-token card. A Prophet Shop card (`shop: 'prophet'` plus `cost.prophet`) needs two more steps:
- Append it to `PROPHET_SHOP_CARD_IDS` in `src/engine/shop/prophet.ts`. Append only, because list order is the sampler's tiebreak, and a Prophet card left off the list never appears.
- Update the hard-coded Prophet count (23) in `test/catalog-integrity.test.ts`, `test/shop-build.test.ts` and `test/shop-prophet-sample.test.ts`.

Keep plain stat lines in `stats` (`{money, buys, actions, cards, vp, prophet}`) and put only non-stat behaviour in `effects`, because Buff/Nerf and card-text templating read `stats`. In engine code, read an instance's stat line through `effectiveStats` (`engine/systems/buff.ts`), never `def.stats`: it composes the definition, the per-match variant and the instance delta.

**When you add a new effect op,** implement it in `effects/ops/*.ts`, then add it in four more places:
- the `EffectNode` union in `types.ts`
- the `applyNode` switch in `effects/index.ts`
- `KNOWN_OPS` in `tools/validate-cards.ts`
- `IMPLEMENTED_OPS` in `test/catalog-integrity.test.ts` (B96)

**Art.** Give a new card `art: { key: '<id>', status: 'placeholder' }`. `art:status` rewrites it to `final` with an artist credit once the jpg exists. Existing slots may also carry `anim`. The art tools work like this:
- `npm run art:generate` builds one prompt per card and aura from catalog data plus a fixed house style (`tools/gen-art.ts`). No prompt is hand-written. `tools/art_render.py` then renders locally with Python and torch/diffusers (CUDA, or very slowly on CPU; `$PYTHON` picks the interpreter) into `public/art/<key>.jpg`. It renders only keys with no file unless you pass `--force`. Seeds are a hash of the key. `--reroll=<key>` bumps that key's salt in `tools/art-seeds.json`, so commit the bump with the jpg.
- `npm run art:status` does a literal text replace across `src/cards/**`, turning `placeholder` into `final` with an artist credit. It writes nothing while any key lacks a jpg; `--check` only verifies.
- `npm run art:thumbs` (`tools/art_thumbs.py`, needs Pillow) derives `public/art/thumb/<key>.webp`: 256px, about 4 KB. Every small card face uses it (`src/ui/art.ts` `artThumbUrl`), and the jpg is only for the hover preview. Run it after `art:generate`.

A missing image silently falls back to a gradient tile and CI never runs `art:status`, so after adding a card run `npm run art:status -- --check`. `docs/ART-MANIFEST.md` is generated by `npm run art:manifest`, so don't edit it by hand. Details are in `public/art/README.md`.

## Conventions

- Most tests start their name with the spec behavior they pin (`B1`–`B120`, e.g. `test('B111: ...')`). The behavior list lives in `.fullsend/SPEC.md`, which is gitignored and may be missing from a fresh clone. Tests added after the spec (catalog audit, lobby, UI) aren't B-numbered. They cite the `SB-n` ruling they pin in the test or describe name, or describe the defect in the file header. Follow that; don't invent B121+. Rules rulings are numbered `SB-n` in `docs/SOLVED-BLOCKERS.md`, and the code cites them in comments.
- Frozen style from the spec: money is a signed integer; time is turn integers, never wall-clock; ids are opaque strings, never parsed; `null` means absent, `undefined` only marks optional fields; camelCase for identifiers and fields. Card, aura and anomaly ids are snake_case of the display name (`temple_marketplace`).
- `MatchConfig` is fixed when the match is created. `createMatch` normalizes it, and anomaly setup may adjust it there. After that the engine only reads `state.config`. The default config is built in three places:
  - `defaultMatchConfig` (`engine/core/setup.ts`)
  - `defaultConfig` (`ui/useGame.ts`, which real games use through `seedMatch`)
  - `DEFAULT_SIM_CONFIG` (`sim/run.ts`, used by balance runs)

  Change a gameplay default in all three. They have drifted before.
- UI: function components and hooks, no state or component libraries. The one class component is `FlipScope` in `useFlip.ts`, because it needs `getSnapshotBeforeUpdate`.
  - The table is one 100dvh grid (`TableLayout` in `App.tsx`): a topbar, an opponents strip, a board region that is the only scroll container for piles, and a dock holding the hand, stats and End turn. The log and graveyard sit in a drawer.
  - Plain CSS: `styles.css` (the layout) and `motion.css` are global, imported by `main.tsx`. `Hand`, `Lobby` and `Opponents` import their own sheets. Those land *before* the global sheets in the bundle, so their rules win through scoped two-class selectors, not source order.
- Rendering is memoised against `stabilizeView` (`src/ui/viewcache.ts`), which reuses unchanged CardView/PileView/seat objects by a per-object signature (`cardSignature` and friends). If you add a field to `CardView` or `PileView` that the UI shows, add it to the signature there. Otherwise memoised cards keep showing the old value.
- Motion: cards that change zone fly as clones in a fixed `.motion-layer`, planned by `motion.ts` and measured by `FlipScope`. Everything else is a one-shot `el.animate()` from a layout effect. Timings live in `MOTION_MS` (`motion.ts`) and the `--t-*` tokens in `motion.css`. Never gate input on an animation, never remount a card to restart one, and animate only transform and opacity.
- Keyboard (`keys.ts`, `useKeyboard.ts`): digits play the hand in the order it is shown, E ends the turn (not Space), M plays money, `[ ]` reorder on your turn, and ? lists the keys. Only advertise keys that work.
- Dev-only fixture tables at `#fixture:<name>` (`Fixture.tsx`, behind `import.meta.env.DEV`) mount the real table over a crafted prompt or motion step for `e2e/fixtures.spec.ts`. The production build contains none of them.
- E2E specs select by `data-testid` (`prompt`, `prompt-option`, `stat-<name>-value`, …) and by `data-*` state attributes (`data-card-id`, `data-pile-id`, `data-buyable`, `data-clickable`, `data-seat-to-move`), so keep both when you edit components. `test/ui-testid-contract.test.ts` pins the testids in `npm test` by rendering each screen with `renderToStaticMarkup`. When an e2e spec starts relying on a new id, add it there. The exceptions are `table`, `connecting`, `you-are`, `seat-btn` and `anomaly-banner`, which only e2e covers. Vitest only collects `test/**/*.test.ts`, so UI unit tests use `React.createElement`, not JSX. A `.test.tsx` file typechecks but never runs.
- Hand order is game state: Loaf of Bread, Brownie and Feel so Clean read their neighbours. Never reorder the hand for display. A drag sends a `reorderHand` action so the engine's order matches what the player sees. Reordering is offered only on your own turn (B20).
- SB-63 (the hand below the fold) is resolved, and its entry lists the rules that keep it resolved. Read it before changing the table layout. `e2e/layout.spec.ts` checks two things at 1280x720 and 1366x768: the page never scrolls, and every Buy control is hit-testable. Earlier CSS fixes were reverted because they left elements invisibly unclickable, which only e2e catches.
- Before resolving a rules question yourself, check `docs/SOLVED-BLOCKERS.md`; most ambiguities are already decided there. `docs/DESIGN-CHOICES.md` explains why the code is shaped the way it is. `ARCHITECTURE.md` and `jlore_jlards_gameplay.md` are the original handoff docs. Where they conflict with the code (a 3-arg `reduce`, JSON cards, inline instances), the code and SOLVED-BLOCKERS win.
