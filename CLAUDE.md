# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Jlore Jlards is a browser deck-builder (Dominion lineage) for 2–4 friends. The host's browser runs a pure rules engine, other players' browsers are dumb terminals that only get filtered views, and the backend is a message relay that parses nothing about the game (one Redis list per room). TypeScript strict, React 18, Vite, Vitest, Playwright. Node 20+.

## Commands

```bash
npm run dev                 # http://localhost:5173; the relay middleware is mounted, so two windows can play multiplayer locally with no Upstash
npm test                    # vitest run (test/**/*.test.ts). Node environment, no DOM: UI tests use renderToStaticMarkup or pure functions
npx vitest run test/core-view.test.ts      # one file
npx vitest run -t "B111"                   # tests whose name matches
npm run typecheck           # tsc --noEmit over src, test, tools, api. e2e/ is outside tsconfig, so spec types are never checked
npm run build               # typecheck + vite build
npm run cards:validate      # catalog integrity. Run it after touching src/cards/
npm run e2e                 # Playwright/Chromium on :5199, serial; skips the "visual record" and "production smoke" suites
npx playwright test e2e/hotseat.spec.ts    # one e2e spec
npm run sim -- --games=25 --players=2 --seed=1          # headless bot matches
npm run balance -- --games=500 --players=3 --seed=1     # bot matches -> telemetry/balance-<stamp>.md
npm run replay -- --seed=42 --players=3 --out=telemetry/bug.json   # bot match; record its action log
npm run replay -- --in=telemetry/bug.json --turn=14                # replay a recording, stop at the start of a turn
npm run relay:check         # hit the real Upstash backend using .env credentials
```

With `--seed` and no `--turn`, `replay` re-runs the log and exits 1 if the two final states differ, which makes it a live B119 check.

Not in CI:
- `npm run shots` (`e2e/screenshots.spec.ts`) plays 26 turns, takes about 15 minutes, and writes PNGs into `shots/`.
- `npm run smoke` (`e2e/smoke.spec.ts`) runs against the live deployment (`SMOKE_URL=…` for a preview). It is the only check that catches a deploy missing its Upstash vars.
- `art:generate` and `art:status` are described under Cards.

A bare `npx playwright test` with no file also runs shots and smoke. Playwright always starts its own `vite --port 5199 --strictPort`, so if a server is already on 5199 the run fails.

CI (`.github/workflows/ci.yml`) runs typecheck, test, cards:validate, a 25-game sim smoke run, and e2e. Treat all five as the bar. There is no ESLint or Prettier. `tsc` is the only static check.

## Architecture

```
src/engine/  pure rules engine: reduce(state, action) -> state
src/cards/   the catalog (~535 CardDefinitions + 25 auras) as typed TS data
src/net/     relay transport, lobby + host loop, client, storage tiers
src/relay/   relay request logic (roomHandler) + Vite dev middleware
api/room/[code].ts   Vercel function: a thin wrapper over src/relay/roomHandler
src/ui/      React app. Hash routes: '' start, #hotseat[:N], #ROOMCODE (lobby first, then the table)
src/sim/     bots, headless runner, telemetry (no fs or clock; the tools/ CLIs do that)
tools/       tsx CLIs (plus art_render.py, the Python renderer behind art:generate); tools/bootstrap.ts fills the registry and parses --flags
```

Path aliases `@engine/*`, `@cards/*`, `@net/*`, `@ui/*`, `@sim/*` are set in three places: tsconfig, vite.config, and vitest.config. If you add or change one, change all three. The exception is `api/room/[code].ts` and what it imports at runtime (`src/relay/roomHandler.ts`). Vercel runs those as plain Node ESM, not through Vite, so they need relative imports with explicit `.js` extensions and never the aliases. Dev and e2e serve the relay through Vite middleware, so only `npm run smoke` catches a mistake there.

### Engine invariants

B117–B119 and "reject leaves state unchanged" are tested. The import boundary, the console ban and synchronicity are convention only.

- **Import boundary:** `src/engine/` never imports from `net/`, `ui/`, `sim/`, or `api/`. The one allowed exception is `registry.ts`, which imports `@cards/index` so it can lazily bootstrap the catalog on first access. No test checks this.
- **Determinism (B117):** no `Math.random`, `Date.now`, or `new Date` anywhere under `src/engine/`. The test does a plain **substring search of file contents**, so comments count too. All randomness comes from `state.seed` + `state.rngCursor` (`rng.ts`, SB-31). There is no shared generator. Each randomness site calls `makeRng(s.seed, s.rngCursor)`, draws, then writes `s.rngCursor = rng.cursor()` back onto the draft. Forget the write-back and the next draw repeats. B119 still passes when that happens, so no test catches it. Pure reads (`costOf`, `legalActions`, rendering) must not advance the cursor. Derive a throwaway stream instead, as `shop/dynamic.ts` does.
- **`reduce` never throws.** It deep-clones the input once at entry with the hand-rolled `core/clone.ts`, not `structuredClone`. So `GameState` must stay plain JSON: a `Map`, `Set`, or class instance becomes a plain object after the first `reduce`, so use records keyed by id. Helpers below `reduce` may mutate that draft freely (Addendum A5). An illegal action returns the state unchanged with a reject `LogEntry` appended, and every branch appends at least one log entry (B118). Throws below `reduce` are contained, not forbidden:
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
- **Two `triggers.ts` files.** `core/triggers.ts` `runEffects` is the one place engine code hands nodes to the interpreter: it applies the depth and budget gates and catches throws. Inside ops, trash, discard and shuffle go through the `effects/triggers.ts` wrappers (`trashWithTrigger`, `discardWithTrigger`, `shuffleWithTrigger`, `fireEvent`), which queue triggers behind the current queue. `core/zones.ts` moves cards without firing anything.
- **Prompts are state:** an op that needs a choice sets `state.pending` and parks the rest of the queue on `state.queue`. The answer comes back as a `resolve` action and `core/resume.ts` continues from there. While `pending` is set, `reduce` rejects every other action type.
- **Expression strings** (`"floor(uniqueCardsInDeck / 3)"`) go through the recursive-descent evaluator in `engine/expr.ts`. It knows the frozen `EXPR_VARS` list plus what the context supplies: loop vars like `x`, and every player counter by its key, with any `turn:` prefix dropped (`effects/context.ts` `buildVars`). No `eval`. At the table a bad expression reads 0 or false. Every `count(x)`/`countIn(zone, x)` name must be in `NAMED_FILTERS` (`effects/select.ts`): an unknown name silently reads 0, and only `cards:validate` catches it.
- **Shop (`src/engine/shop/`).** A match offers `config.prophetPileCount` Prophet piles (default 4), sampled one per threshold band from `PROPHET_SHOP_CARD_IDS` in `shop/prophet.ts`. Prophet buys cost no Money and no Buy, only the threshold. A price that reads live state goes in `DYNAMIC_PRICES` (`shop/dynamic.ts`) and must be pure, because `costOf` also runs during rendering and in `legalActions`.
- **`src/engine/types.ts` is the shared type surface.** Its header calls it frozen, but new fields and ops are added there. It imports nothing. By convention (not a test), no other file redeclares a name that appears in it.

### Hidden information

`engine/view.ts` `viewFor(state, player)` decides what each seat is given to render. Libraries (including your own) and opponents' hands appear only as counts. A pending prompt's options go only to the player who must choose. **B111** (in `test/net-host.test.ts`) serializes every published view and asserts no hidden instance id leaks. If you add a field to `GameState` that could carry card identities, decide how `viewFor` treats it. The client (`net/client.ts`) deliberately ignores `snapshot` messages and never holds a `GameState`. The UI (`useGame.ts`) only keeps `GameView`s in React state.

- `secret` values reach only their owner, and only on card faces. Instance `counters` are public to every seat (B24). The log scrub replaces only strings that are hidden instance ids, so any other detail you log reaches every seat. Never log a secret value or a hidden random-branch pick. Today `scoreOnCard` with `secret: true` logs its amount and `random` logs its branch index, which exposes Ascendant Spread's secret VP.
- `viewFor` limits what a seat renders, not what the relay carries. A GET returns every message regardless of `to`, and the host posts the full `GameState` as a `snapshot` each turn. ARCHITECTURE.md §6 and §8 accept this. B111 audits only `view` messages, so don't write a test that expects the queue itself to be clean.
- `vp` in `GameView` (`you.vp`, `others[].vp`) is `player.vp`, which holds only VP granted by effects. Printed and accrued card VP is counted only by the scorers (`core/scoring.ts`, and `meta/scoring.ts` `liveVp` for win conditions), so the VP stat in the UI is not the score. Don't publish a scorer's total for opponents as-is: it sums their hidden library and hand plus `secret` VP.

### Networking

Messages use the envelope `{seq, from, to?, kind: 'intent'|'view'|'hello'|'snapshot', payload}` (the four kinds are frozen) and ride one shared Redis list per room (`jlore:room:CODE`, 6h TTL). `net/host.ts` polls for intents, runs `reduce`, and posts one `view` per seat. `net/relay.ts` has two transports behind one `Relay` interface:
- HTTP polls every 1s, or every 3s when the tab is hidden. It stops for good after 10 minutes with no received traffic: `bump()` resets the timer but does not restart a stopped loop.
- `makeLocalRelay()` is used by hotseat and the tests.

`useGame.ts` wires three modes (hotseat, host, join) through one hook.

- **Lobby (SB-64).** Networked rooms open as a lobby, and nothing is dealt until the host presses Start. `seedMatch` then deals for exactly the roster. Hotseat and a host resuming a snapshot deal immediately. The lobby adds no message kind:
  - Presence is a `hello` that clients repeat every 4s. The host drops a seat after 20s of silence.
  - The roster is a broadcast `view` (no `to`) carrying a `LobbyPayload`. `isLobbyPayload` and the client's `isView` must stay mutually exclusive (`test/net-lobby.test.ts`).
  - `startHost(relay, state, {seats, since})` binds seats to `playerOrder` before it reads any message, then polls from the lobby's cursor.
- **Seat identity** is the token in the `jlore_seat` cookie. It is the `from` of every message, and the host maps it to a `PlayerId`, so a refresh reclaims the same seat. Whether `#CODE` hosts or joins is decided per tab: `App.tsx` hosts only when this tab's sessionStorage `jlore_open_lobbies` lists the code, and that entry is dropped once cards are dealt. So a host who reloads mid-match comes back as a joiner. They must resume from the snapshot on the start screen, which opens a new room code.
- **The memory-fallback trap.** The relay falls back to an in-memory store when the Upstash vars are missing, when the URL is not `https://`, or when `new Redis()` throws. That's why e2e and dev need no credentials, and why a green test suite proves nothing about the live backend. On Vercel it silently breaks multiplayer, because serverless instances don't share memory, yet every request still returns 200. Diagnose it three ways:
  - the `x-jlore-store: redis|memory` response header, which says which store answered
  - `relay:check`, which checks the credentials
  - `npm run smoke`, which checks the deployment

  Use the Upstash **REST** URL (`https://…`), not the `redis://` one, and paste env values without quotes (a quoted URL throws `UrlError`). The Redis `RoomStore` adapter is copy-pasted in `api/room/[code].ts`, `src/relay/devMiddleware.ts`, and `tools/relay-check.ts`, so change all three together.

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

**Art.** Write every card's art slot exactly as `art: { key: '<id>', status: 'placeholder' }`. The art tools work like this:
- `npm run art:generate` builds one prompt per card and aura from catalog data plus a fixed house style (`tools/gen-art.ts`). No prompt is hand-written. `tools/art_render.py` then renders locally with Python and torch/diffusers (CUDA, or very slowly on CPU; `$PYTHON` picks the interpreter) into `public/art/<key>.jpg`. It renders only keys with no file unless you pass `--force`. Seeds are a hash of the key. `--reroll=<key>` bumps that key's salt in `tools/art-seeds.json`, so commit the bump with the jpg.
- `npm run art:status` does a literal text replace across `src/cards/**`, turning `placeholder` into `final` with an artist credit. It writes nothing while any key lacks a jpg; `--check` only verifies.

A missing image silently falls back to a gradient tile and CI never runs `art:status`, so after adding a card run `npm run art:status -- --check`. `docs/ART-MANIFEST.md` is generated by `npm run art:manifest`, so don't edit it by hand. Details are in `public/art/README.md`.

## Conventions

- Most tests start their name with the spec behavior they pin (`B1`–`B120`, e.g. `test('B111: ...')`). The behavior list lives in `.fullsend/SPEC.md`, which is gitignored and may be missing from a fresh clone. Tests added after the spec (catalog audit, lobby, UI) aren't B-numbered. They cite the `SB-n` ruling they pin in the test or describe name, or describe the defect in the file header. Follow that; don't invent B121+. Rules rulings are numbered `SB-n` in `docs/SOLVED-BLOCKERS.md`, and the code cites them in comments.
- Frozen style from the spec: money is a signed integer; time is turn integers, never wall-clock; ids are opaque strings, never parsed; `null` means absent, `undefined` only marks optional fields; camelCase for identifiers and fields. Card, aura and anomaly ids are snake_case of the display name (`temple_marketplace`).
- `MatchConfig` is fixed when the match is created. `createMatch` normalizes it, and anomaly setup may adjust it there. After that the engine only reads `state.config`. The default config is built in three places:
  - `defaultMatchConfig` (`engine/core/setup.ts`)
  - `defaultConfig` (`ui/useGame.ts`, which real games use through `seedMatch`)
  - `DEFAULT_SIM_CONFIG` (`sim/run.ts`, used by balance runs)

  Change a gameplay default in all three. They have drifted before.
- UI: function components and hooks, no state or component libraries. Plain CSS: `styles.css` and `motion.css` are global (imported by `main.tsx`). `Hand`, `Lobby` and `Opponents` import their own sheets, which land *before* the global sheets in the bundle, so their rules win through scoped two-class selectors, not source order.
- E2E specs select by `data-testid` (`prompt`, `prompt-option`, `stat-<name>-value`, …) and by `data-*` state attributes (`data-card-id`, `data-pile-id`, `data-buyable`, `data-clickable`, `data-seat-to-move`), so keep both when you edit components. `test/ui-testid-contract.test.ts` pins the testids in `npm test` by rendering each screen with `renderToStaticMarkup`. When an e2e spec starts relying on a new id, add it there. The exceptions are `table`, `connecting`, `you-are`, `seat-btn` and `anomaly-banner`, which only e2e covers. Vitest only collects `test/**/*.test.ts`, so UI unit tests use `React.createElement`, not JSX. A `.test.tsx` file typechecks but never runs.
- Hand order is game state: Loaf of Bread, Brownie and Feel so Clean read their neighbours. Never reorder the hand for display. A drag sends a `reorderHand` action so the engine's order matches what the player sees.
- SB-63 (the hand can sit below the fold) is the one unresolved entry in SOLVED-BLOCKERS. Read it before changing the table layout. Two CSS fixes were tried and reverted because they left elements invisibly unclickable, which only `npm run e2e` catches.
- Before resolving a rules question yourself, check `docs/SOLVED-BLOCKERS.md`; most ambiguities are already decided there. `docs/DESIGN-CHOICES.md` explains why the code is shaped the way it is. `ARCHITECTURE.md` and `jlore_jlards_gameplay.md` are the original handoff docs. Where they conflict with the code (a 3-arg `reduce`, JSON cards, inline instances), the code and SOLVED-BLOCKERS win.
