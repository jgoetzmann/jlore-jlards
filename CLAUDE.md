# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Jlore Jlards is a browser deck-builder (Dominion lineage) for 2–4 friends. The host's browser runs a pure rules engine, other players' browsers are dumb terminals that only get filtered views, and the backend is a ~40-line message relay. TypeScript strict, React 18, Vite, Vitest, Playwright. Node 20+.

## Commands

```bash
npm run dev                 # http://localhost:5173; the relay middleware is mounted, so no Upstash is needed locally
npm test                    # vitest run (test/**/*.test.ts, node environment)
npx vitest run test/core-view.test.ts      # one file
npx vitest run -t "B111"                   # tests whose name matches
npm run typecheck           # tsc --noEmit (covers src, test, tools, api)
npm run build               # typecheck + vite build
npm run cards:validate      # catalog integrity. Run it after touching src/cards/
npm run e2e                 # Playwright/Chromium on port 5199, serial (workers: 1)
npx playwright test e2e/hotseat.spec.ts    # one e2e spec
npm run sim -- --games=25 --players=2 --seed=1   # headless bot matches
npm run replay -- --seed=42 --players=3 --turn=14  # reproduce a match, stop at a turn
npm run relay:check         # hit the real Upstash backend using .env credentials
```

CI (`.github/workflows/ci.yml`) runs typecheck, test, cards:validate, a 25-game sim smoke run, and e2e. Treat all five as the bar.

There is no ESLint or Prettier. `tsc` is the only static check.

## Architecture

```
src/engine/  pure rules engine: reduce(state, action) -> state
src/cards/   533 CardDefinitions + 25 auras as typed TS data
src/net/     relay transport, host loop, client, storage tiers
src/relay/   relay request logic (roomHandler) + Vite dev middleware
api/room/[code].ts   Vercel function: a thin wrapper over src/relay/roomHandler
src/ui/      React app. Hash routes: '' start, #hotseat:N, #ROOMCODE
src/sim/     bots, headless runner, telemetry (no fs or clock; the tools/ CLIs do that)
tools/       tsx CLIs; tools/bootstrap.ts fills the registry and parses --flags
```

Path aliases `@engine/*`, `@cards/*`, `@net/*`, `@ui/*`, `@sim/*` are set in three places: tsconfig, vite.config, and vitest.config. If you add or change one, change all three.

### Engine invariants (tests enforce these)

- **Import boundary:** `src/engine/` never imports from `net/`, `ui/`, `sim/`, or `api/`. The one allowed exception is `registry.ts`, which imports `@cards/index` so it can lazily bootstrap the catalog on first access.
- **Determinism (B117):** no `Math.random`, `Date.now`, or `new Date` anywhere under `src/engine/`. The test does a plain **substring search of file contents**, so comments count too. All randomness comes from `state.seed` + `state.rngCursor` (`rng.ts`). `reduce` builds its generator from those and returns the advanced cursor. No rng is injected (SB-31).
- **`reduce` never throws.** It deep-clones the input once at entry. Helpers below it may mutate that draft freely (Addendum A5). An illegal action returns the state unchanged with a reject `LogEntry` appended, and every branch appends at least one log entry (B118). Never use `console` for game events. The only place a throw is correct is `registry.getCard` on an unknown id.
- **Replay (B119):** re-running `createMatch` plus the logged actions must reproduce the exact state. This is what `npm run replay` relies on.
- **The engine is fully synchronous.** Only `net/` is async.

### Core engine mechanics (these span several files)

- **Card identity has three levels:** `CardDefinition` (the printed card, in the registry) → per-match variant overrides (Buff/Nerf, elements) → `CardInstance`. Instances live in a central `state.instances` registry. Zones hold ordered `InstanceId[]` (SB-32).
- **Effects are a typed node tree** interpreted by `src/engine/effects/index.ts`. The ~60 ops are dispatched from `applyNode`, and implementations live in `effects/ops/*.ts`. Nodes resolve FIFO off a queue, never the JS call stack. Hard limits: `config.effectNodeBudget` nodes per turn, `config.recursionDepth` nesting, and `PROMPT_BUDGET_PER_TURN` (60) in `core/resume.ts` for prompt chains. Hitting any limit fizzles and logs; it never hangs or throws. An unknown op is logged and skipped.
- **Prompts are state:** an op that needs a choice sets `state.pending` and parks the rest of the queue on `state.queue`. The answer comes back as a `resolve` action and `core/resume.ts` continues from there. While `pending` is set, `reduce` rejects every other action type.
- **Expression strings** (`"floor(uniqueCardsInDeck / 3)"`) go through the recursive-descent evaluator in `engine/expr.ts`, which only knows a frozen variable list. No `eval`.
- **`src/engine/types.ts` is the frozen type surface.** It imports nothing, and no other file may redeclare a name that appears in it.

### Hidden information

`engine/view.ts` `viewFor(state, player)` is the only security in the system. Libraries (including your own) and opponents' hands appear only as counts. A pending prompt's options go only to the player who must choose. `secret` values go only to their owner. The log is scrubbed of hidden instance ids. **B111** (in `test/net-host.test.ts`) serializes every published view and asserts no hidden instance id leaks. If you add a field to `GameState` that could carry card identities, decide how `viewFor` treats it. The client (`net/client.ts`) deliberately ignores `snapshot` messages and never holds a `GameState`. The UI (`useGame.ts`) only keeps `GameView`s in React state.

### Networking

Messages use the envelope `{seq, from, to?, kind: 'intent'|'view'|'hello'|'snapshot', payload}` and ride one shared Redis list per room (`jlore:room:CODE`, 6h TTL). `net/host.ts` polls for intents, runs `reduce`, and posts one `view` per seat. `net/relay.ts` has two transports behind one `Relay` interface: HTTP (1s poll, a 250ms "hot" window after activity, 3s when the tab is hidden, stops after 10 min idle) and `makeLocalRelay()`, which hotseat and the tests use. `useGame.ts` wires three modes — hotseat, host, join — through the same code path. When the Upstash env vars are absent, the relay falls back to an in-memory store. That's why e2e and dev need no credentials, and why a green test suite proves nothing about the live backend (use `relay:check` for that). Use the Upstash **REST** URL (`https://…`), not the `redis://` one.

### Cards

To add a card, add a `CardDefinition` to the right file under `src/cards/<group>/`. Each group's barrel exports `cards`, and `src/cards/index.ts` concatenates them. You don't need engine changes unless the card needs a new effect op. Keep plain stat lines in `stats` (`{actions, cards, money, buys, prophet}`) and put only non-stat behaviour in `effects`, because Buff/Nerf and card-text templating read `stats`. Every card carries an `art` slot. **When you add a new effect op,** add it to the `EffectNode` union in `types.ts`, to `applyNode` in `effects/index.ts`, and to the `KNOWN_OPS` runtime mirror in `tools/validate-cards.ts`.

## Conventions

- Tests cite numbered spec behaviors (`B1`–`B120`) in their names and file headers, e.g. `test('B111: ...')`. The behavior list lives in `.fullsend/SPEC.md`, which is gitignored and may be missing from a fresh clone. Rules rulings are numbered `SB-n` in `docs/SOLVED-BLOCKERS.md`, and the code cites them in comments.
- Frozen style from the spec: money is a signed integer; time is turn integers, never wall-clock; ids are opaque strings, never parsed; `null` means absent, `undefined` only marks optional fields; camelCase everywhere; `MatchConfig` is read once, in `createMatch`.
- UI: function components and hooks, plain CSS (`src/ui/styles.css`, `motion.css`), no state or component libraries. E2E specs select elements by `data-testid` (`prompt`, `prompt-option`, `stat-<name>-value`, …), so keep those attributes when you edit components.
- Before resolving a rules question yourself, check `docs/SOLVED-BLOCKERS.md`; most ambiguities are already decided there. `docs/DESIGN-CHOICES.md` explains why the code is shaped the way it is. `ARCHITECTURE.md` and `jlore_jlards_gameplay.md` are the original handoff docs. Where they conflict with the code (a 3-arg `reduce`, JSON cards, inline instances), the code and SOLVED-BLOCKERS win.
