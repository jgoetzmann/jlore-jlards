# Jlore Jlards

A digital deck-builder in the Dominion lineage, for 2–4 people in different
houses who are already in a Discord call.

Three things make it not-Dominion:

- **Prophet** — a second currency that never resets, with its own shop gated by
  *thresholds* rather than money. A parallel track you invest in all game.
- **Anomalies** — roughly a third of matches roll a global rule-warping
  modifier: extra resources, replaced starting decks, changed win conditions, or
  a full five-element subsystem.
- **Auras** — persistent per-player enchantments in a Field zone. Heroic
  (activated, once per turn), Celestial (passive), Hypercelestial (rare,
  match-defining).

Setting: 2,000 years from now, reality is unravelling. You are a **Navigator**
sent back with the **Stellar Codex** to mend anomalies. Your opponents are
**Echoes** — rival Navigators from divergent futures.

---

## Run it

```bash
npm install
npm run dev            # http://localhost:5173 — click Hotseat to play immediately
```

Hotseat needs no network and no backend. For multiplayer, copy `.env.example` to
`.env`, fill in Upstash credentials, and deploy to Vercel; the host shares the
`#ROOMCODE` link and everyone clicks it.

## Everything else

```bash
npm test               # the suite
npm run typecheck      # tsc --noEmit
npm run cards:validate # catalog integrity — run this after adding cards
npm run sim            # headless bot matches
npm run balance        # balance telemetry report -> telemetry/
npm run cards:export   # cards + auras as JSON, for art tooling
npm run art:manifest   # docs/ART-MANIFEST.md — art worklist by status
```

## How it fits together

One browser — the host's — runs the engine. Everyone else runs a dumb terminal
that renders a filtered view and posts button presses back. The server is a
message queue that has never heard of a card game.

```
Host browser                 Vercel relay              Friends' browsers
┌───────────────────┐        ┌──────────────┐          ┌──────────────────┐
│ engine (pure fn)  │ views  │ Redis list   │  views   │ renders view     │
│ full game state   │───────>│ opaque blobs │─────────>│ knows only their │
│ view filter       │<───────│              │<─────────│ own hand         │
└───────────────────┘ intents└──────────────┘  intents └──────────────────┘
```

Hidden information is *absent* from a non-host browser, not hidden by CSS. Your
opponent's hand was never sent, so there is nothing to find in devtools. That is
the whole security model and it is about 40 lines.

```
src/engine/   pure rules engine — no I/O, no React, no fetch
  types.ts      the frozen type surface everything imports
  index.ts      reduce(state, action) -> state
  rng.ts        seeded PRNG; no Math.random anywhere under engine/
  view.ts       viewFor(state, player) — the only security in the system
  effects/      the effect-node interpreter (~60 ops)
  shop/ systems/ meta/
src/cards/    ~400 card definitions as typed data
src/net/      relay poll loop, host, client, storage tiers
src/ui/       React components
src/sim/      bots, headless match runner, balance telemetry
api/          the entire backend, ~40 lines
tools/        CLIs for sim, balance, validation, export, art manifest
test/         the suite
```

The boundary that matters: **nothing in `src/engine/` imports from `src/net/`,
`src/ui/`, or `api/`.** That is what keeps the transport swappable and the tests
trivial, and it is why moving to a server-authoritative model later is a file
move rather than a rewrite.

## Adding a card

Add an entry to the right file under `src/cards/`, then:

```bash
npm run cards:validate
```

No engine changes unless the card needs a genuinely new effect op. `stats` holds
plain stat lines (`+1 Action, +2 Money`); only non-stat behaviour goes in
`effects`. That split is what lets Buff/Nerf find a stat line at all.

## Docs

| File | What |
|---|---|
| [`docs/DESIGN-CHOICES.md`](docs/DESIGN-CHOICES.md) | Why the code is shaped this way |
| [`docs/SOLVED-BLOCKERS.md`](docs/SOLVED-BLOCKERS.md) | Every open rules question, decided |
| [`docs/ART-MANIFEST.md`](docs/ART-MANIFEST.md) | Generated art worklist |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Original topology handoff |
| [`jlore_jlards_gameplay.md`](jlore_jlards_gameplay.md) | Original rules and card catalog handoff |

## Known weaknesses, accepted

The host closing their tab ends the game. The host's browser can see all state.
A determined player could read another seat's view off the relay queue with
devtools. Clearing your browser wipes your Codex. All four are fine: it's an
hour-long session with people you're on a call with, and the fix for any of them
costs more than the problem.
