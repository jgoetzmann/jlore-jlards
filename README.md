# Jlore Jlards

### ▶ [Play it](https://jlore-jlards.vercel.app)

A digital deck-builder in the Dominion lineage, for 2–4 people in different
houses who are already in a Discord call.

Click **Hotseat** to play immediately — two players, two hands, one browser, no
account and no setup. **Create a room** gives you a `#ROOMCODE` link to paste
into a call.

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

Hotseat needs no network and no backend: two players, two hands, one browser.
`npm run dev` also mounts the relay, so you can open two windows and play a real
multiplayer game locally.

## Deploying

The whole backend is one serverless function over a Redis list. Import the repo
at [vercel.com/new](https://vercel.com/new) — `vercel.json` already sets the
build command, output directory and function limits, and `api/room/[code].ts`
becomes `/api/room/:code` through Vercel's own file-based routing.

Set two environment variables from the Upstash console's **REST** credentials:

```
UPSTASH_REDIS_REST_URL     https://<your-db>.upstash.io
UPSTASH_REDIS_REST_TOKEN   <token>
```

Paste the raw values — no surrounding quotes. The Upstash client rejects a
quoted URL with `UrlError`, and use the REST url rather than the `redis://`
connection string.

Without those two, the relay falls back to an in-process store. That is fine
locally but not on serverless, where invocations do not share memory: hotseat
still works, multiplayer does not. Check it with:

```bash
npm run relay:check    # drives the real handler against your live Redis
```

```bash
npm run relay:check    # confirms the credentials and the live backend actually work
```

Worth running before you blame the game. The test suite exercises the relay
against an in-memory store, so a green suite proves nothing about your database
or network path — this drives the real handler against real Redis. Use the
**REST** url from the Upstash console (`https://…`), not the `redis://`
connection string.

## Everything else

```bash
npm test               # the suite
npm run typecheck      # tsc --noEmit
npm run cards:validate # catalog integrity — run this after adding cards
npm run sim            # headless bot matches
npm run balance        # balance telemetry report -> telemetry/
npm run replay -- --seed=42 --players=3          # reproduce a match exactly
npm run replay -- --seed=42 --players=3 --turn=14  # stop and print the board
npm run e2e            # play the game in a real Chromium, incl. two-browser multiplayer
npm run relay:check    # verify Upstash credentials + the live relay backend
npm run cards:export   # cards + auras as JSON, for art tooling
npm run art:generate   # render card art locally into public/art/
npm run art:status     # mark catalog art placeholder -> final once it exists
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
src/cards/    534 card definitions + 25 auras, as typed data
src/net/      relay poll loop, host, client, storage tiers
src/ui/       React components
src/sim/      bots, headless match runner, balance telemetry
api/          the entire backend, ~40 lines
tools/        CLIs for sim, balance, replay, validation, export, art manifest
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

Then give it a picture:

```bash
npm run art:generate   # renders only what has no file yet
npm run art:status     # marks the new card's art final
```

## Art

Every card and aura has an illustration in `public/art/`, generated locally from
the card's own catalog data — name, subtypes, type, rarity — against one fixed
house style. There is no per-card prompt to write, so a new card gets art from
the same rules the other 558 got.

The seed is a hash of the card's art key, so the set is reproducible: the same
card renders the same picture on any machine, an interrupted run resumes by
skipping what exists, and a card that draws a dud can be re-rolled on its own
(`npm run art:generate -- --reroll=copper`) with the bump recorded in
`tools/art-seeds.json`. Details and the commissioned-art path are in
[`public/art/README.md`](public/art/README.md).

## Docs

| File | What |
|---|---|
| [`docs/DESIGN-CHOICES.md`](docs/DESIGN-CHOICES.md) | Why the code is shaped this way |
| [`docs/SOLVED-BLOCKERS.md`](docs/SOLVED-BLOCKERS.md) | Every open rules question, decided |
| [`docs/ART-MANIFEST.md`](docs/ART-MANIFEST.md) | Generated art worklist |
| [`ARCHITECTURE.md`](ARCHITECTURE.md) | Original topology handoff |
| [`jlore_jlards_gameplay.md`](jlore_jlards_gameplay.md) | Original rules and card catalog handoff |

## Does it actually work?

`npm test` proves the engine's rules. It does not prove the game is playable —
that needs a browser.

```bash
npm run e2e            # 14 specs, real Chromium
npm run e2e:headed     # watch it play
```

Two suites. `e2e/hotseat.spec.ts` plays a real two-player game by clicking:
deals five cards, plays a Copper for money, buys from a pile, ends the turn,
passes the seat, and runs twelve turns without falling over. `e2e/multiplayer.spec.ts`
opens **two independent Chromium contexts** — separate cookies, separate
localStorage, separate seats — has one host a room and the other join by URL,
and checks that plays propagate, turns alternate, and a refresh puts you back
in your own seat.

The hidden-information spec is worth understanding precisely. It asserts that
neither browser's DOM contains the other player's hand instance ids, which is
what `viewFor` actually guarantees. It deliberately does **not** assert that the
relay queue is unreadable: addressed views ride one shared list, and
`ARCHITECTURE.md` §6 accepts that a determined player could fish another seat's
view out of it with devtools. That is the stated privacy bar, and the test pins
the real boundary rather than a flattering one.

## Reproducing a bug from a playtest

A bug report is two numbers. `reduce` is a pure function of `(state, action)` and
every random pull comes from `state.seed` + `state.rngCursor`, so the same seed
and the same action list always reproduce the same match.

```bash
npm run replay -- --seed=42 --players=3 --out=telemetry/bug.json   # record it
npm run replay -- --in=telemetry/bug.json                          # replay it
npm run replay -- --in=telemetry/bug.json --turn=14                # stop at turn 14
```

That is also what makes animation timing testable: re-run the same match and the
same cards resolve in the same order every time.

## Known weaknesses, accepted

The host closing their tab ends the game. The host's browser can see all state.
A determined player could read another seat's view off the relay queue with
devtools. Clearing your browser wipes your Codex. All four are fine: it's an
hour-long session with people you're on a call with, and the fix for any of them
costs more than the problem.
