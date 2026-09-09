# Design Choices

Why this build is shaped the way it is. Rules-level questions live in
[SOLVED-BLOCKERS.md](SOLVED-BLOCKERS.md); this file is about the code.

---

## 1. The engine is a pure function, and the randomness lives inside it

```ts
reduce(state: GameState, action: GameAction): GameState
```

No I/O, no framework, no network awareness, no clock. Everything good about this
architecture falls out of that one property:

- Tests need no infrastructure — feed an action list, assert on state.
- Hotseat works before multiplayer exists. Same function, one browser.
- Multiplayer is a transport swap, not a rewrite.
- A bug is `(seed, actionLog)`, pasteable into a test.

The one deviation from `ARCHITECTURE.md` is that the rng is **not** injected; the
cursor lives in `GameState` and `reduce` derives a fresh generator from
`(seed, cursor)` on each call. That makes purity unconditional instead of
depending on every caller recreating the generator at the right position. It also
means the entire random state serializes with the game state, which is what makes
the "move `reduce` into a serverless function later" upgrade path real rather
than aspirational. Full reasoning in SB-31.

**No `Math.random` under `src/engine/`.** Behavior B117 tests for it. This is not
about security — it is that "the Grapevine did something weird and then Misery
replayed it" is unreproducible otherwise, and with ~400 cards this pool will
produce that sentence constantly.

## 2. Three levels of card identity, decided before any card was written

```
CardDefinition  — immutable shipped content. The printed card.
      ↓
CardVariant     — per-match overrides: Universal Buff/Nerf, elemental assignment
      ↓
CardInstance    — one physical card: zone, owner, flags, counters, stat deltas
```

Two cards force this and both exist: *Universal Buff!* buffs every copy of a
definition wherever it is, and *Quick Patch* buffs one instance. A flat card
object cannot express both at once, and retrofitting instance state onto 400
flat cards is the worst version of this project.

Instances live in a central `state.instances` registry; zones hold ordered
`InstanceId[]`. `ARCHITECTURE.md` sketched inline instance objects — the registry
is the same model with stable references, which matters because every
counter-reading card touches an instance the current effect did not select. SB-32.

## 3. `stats` is separate from `effects`

```jsonc
"stats":   { "actions": 1, "cards": 1, "money": 1 },   // structured
"effects": [ /* only non-stat behaviour */ ]
```

Buff/Nerf picks a random base stat and ±1s it. If "+1 Money" is buried in a
scripted effect blob, Buff cannot find it. This one split is also what lets the
MEOW anomaly rewrite words without touching keywords, and what makes card text
templating possible at all.

## 4. Effects are a typed node tree, not scripts

~60 ops, one interpreter, cards as data. The alternative — hand-scripting each
card — does not survive 400 cards, and it makes every cross-cutting system
(multipliers, the Five Elements anomaly, Hivemind's effect absorption) impossible
to implement without touching every card.

Expressions are strings (`"floor(uniqueCardsInDeck / 3)"`) parsed by a small
recursive-descent evaluator over a **frozen variable list** — no `eval`, no
dynamic property access. Structured expression trees would be safer to type but
are miserable to author 400 times; a parser with a closed variable set gets both.

## 5. Prompts are state, not callbacks

```ts
state.pending = { type: 'discover', player: 'p2', options: [...] }
```

The engine cannot `await` a click. So a Discover sets `pending` and returns; the
UI renders a picker; the choice arrives as a normal `resolve` action and
resolution continues. The same mechanism works whether the picker is local or
three network hops away, which is why multiplayer needs no special-casing for the
~60 cards that Discover.

## 6. Effect resolution is a queue with a hard budget

Not a synchronous call stack. Nodes resolve FIFO; a node needing a choice
suspends the queue; triggers enqueue behind the current node.

**Depth cap and cycle detection are mandatory, not defensive.** *The Past* copies
the last card played, *The Future* copies the next, and *The Eternal Show*
explicitly describes the loop between them. *Grape* plays a random Action in
hand, which can be another Grape. *Misery* replays every Action played this turn.
`config.effectNodeBudget` (200) and `config.recursionDepth` (8) fizzle instead of
hanging. SB-24 turns the paradox into a detectable, payable event rather than a
crash.

## 7. Hidden information is absent, not hidden

The view filter is the only security in the system and it is about 40 lines:

- Libraries are counts, never contents — **including your own**. Otherwise the
  draw mechanic is pointless.
- Opponents' hands are counts.
- A `pending` prompt ships its options only to the player who must choose.
  Otherwise a Discover leaks three cards to the table.
- `secret` values (Ascendant Spread's real VP) reach only their owner.
- Chaos entries 12–15 share one display string on purpose; the view carries the
  string, never the resolved card.

Behavior B111 is the test worth never deleting: a serialized view must not
contain an instance id from anyone else's library or hand.

This is cheap to achieve because the data never crosses the wire — there is
nothing to find in devtools because nothing was sent. No encryption, no auth, no
validation. Just don't send it.

## 8. Host-authoritative, relay-dumb

One browser runs the engine. Everyone else renders a filtered view and posts
intents. The relay is ~40 lines of Vercel function over a Redis list and has
never heard of a card game.

Polling at 1s, not WebSockets. The game is turn-based, nobody notices, and it
eliminates connection lifecycle, reconnect logic, and the function duration cap
outright. Backoff to 3s on a hidden tab; stop after 10 minutes idle.

Not WebRTC: it fails on some home and corporate networks in ways that are opaque
to debug, and "Dave can't join and neither of us knows why" is a worse problem
for a casual game than a free serverless function.

The accepted weaknesses are real and listed in `ARCHITECTURE.md` §13. The
important one: **the upgrade path is short.** Move `reduce` into
`api/room/[code].ts`, keep state in Redis, and the server becomes authoritative
with the engine unchanged. That is the entire dividend from writing it pure.

## 9. TypeScript, not JavaScript

`ARCHITECTURE.md` writes the engine in `.js`. This build is TypeScript, for two
reasons that both come from the card pool's size:

1. A 60-op effect DSL authored 400 times will contain typos. In a typed module
   `tsc` finds them; in JSON a player finds them mid-match.
2. The build needed a mechanical damage detector for the parallel-construction
   phase, and `tsc --noEmit` is exactly that.

Cards stay data — `npm run cards:export` emits JSON for art tooling and anything
outside the type system. SB-33.

## 10. Built for the work that comes after

The stated use for this repo is art, animation, playtesting, balance, and QA. So:

- **Every card carries an `art` slot** (`key`, `status`, `artist`, `anim`) from
  the first commit. `npm run art:manifest` lists every card whose art is still a
  placeholder, so the art pass has a worklist instead of a spreadsheet. That
  worklist is now empty — see §10.1.

### 10.1 The art is generated, and generating it is one command

533 cards and 25 auras need 559 illustrations, which is not a thing anyone draws
for a hobby project, and a directory of gradient placeholders is not a game. So
art is produced the same way cards are: **from the catalog, by rule.**

`tools/gen-art.ts` owns the prompts and `tools/art_render.py` owns the pixels,
meeting at `dist-cards/art-jobs.json` — the same seam `cards:export` already uses
to hand catalog data to art tooling. A card's prompt is built from its own data
(name, subtypes, type, rarity) against one fixed house style. The split is the
whole design: the house style is what makes 559 images read as one game, and the
per-card clause is what makes them different. **No prompt is hand-authored**, so
adding a card to `src/cards/` gets art from the rules the other 558 got.

Four decisions worth keeping:

**Local, not a hosted image API.** The free endpoints throttle anonymous callers
to roughly one image per 45 seconds per address — about seven hours per full run,
with a fresh failure every time the limit moves. A local model on the machine's
own GPU does the same 559 in ~13 minutes, offline, unmetered. It also takes a
real `negative_prompt`, which turned out to be the only reliable fix for the
first run's actual defects.

**Seeds, for the same reason the engine has them.** Each image's seed is a hash
of its art key, so the set is reproducible on any machine, an interrupted run
resumes by skipping what exists, and re-running never silently redraws the set.

**A recorded re-roll.** At this scale the prompt stops being the only variable: a
good prompt still draws the occasional dud, and Copper's first render came out as
a ceramic plate while the *identical* prompt on another seed produced a hoard of
coins. `--reroll=<key>` bumps that key's salt in `tools/art-seeds.json` and
re-renders only it. Committing the bump is what keeps determinism honest — a
fresh clone regenerates the accepted image rather than rolling the dice again.

**JPEG, not PNG.** The art is opaque, because the client draws the card frame
itself, so alpha is never used. PNG on painterly content would have taken the
committed set from ~29 MB to well over 250 MB for no visible difference.

Two failures here were only findable by looking at the output, which is worth
recording because both were silent:

- **The prompt named what it wanted to exclude.** "no text, no border" in a
  positive prompt is not negation — it is a list of nouns, and the model drew
  ornate gold borders and garbled lettering on every card. Suppression belongs in
  `negative_prompt`; the positive prompt should never name the unwanted thing.
- **CLIP truncates at 77 tokens** and says so in a warning that scrolls past in a
  559-image run. The style clauses sit at the end of the prompt, so overrunning
  the budget silently dropped exactly the terms holding the set together. Prompts
  now measure 46–66 tokens and there is a check for it.
- **`npm run sim`** plays bot matches headlessly and **`npm run balance`**
  aggregates win rate by card and anomaly, buy rate and first-buy turn, match
  length by variant, which end condition fired, and Discover offered-vs-picked
  rates. A card offered constantly and never picked is a dead card, and that is
  not findable by inspection when the balance surface is randomized anomalies ×
  permanent Buff/Nerf. Instrumented from the first playable build, not after.
- **`npm run cards:validate`** checks catalog integrity — unique ids and names,
  every op implemented, every referenced `defId` real, every Prophet card
  correctly gated. It is the QA net for adding cards without reading engine code.
- **Replay from `(seed, actionLog)`** (B119) means a playtest bug report is two
  numbers, and animation timing can be re-run against a fixed match.

## 11. What was deliberately not built

Listed in full under **Out of scope** in `.fullsend/SPEC.md`. The four that cost
the most and bought the least:

| Cut | Replaced with | Why |
|---|---|---|
| Arc of the Universe's 3-D gravitational sim | A weighted roll, 1% for +999 VP | A persistent 3-D visualization for one card. The roll keeps the entire table experience. |
| A "reality where you win" solver | A hand-tuned heuristic scorer | Three cards consult it. The flavor survives; the compute doesn't happen. |
| A real blackjack sub-game | Scripted draw with the dealer's stand-on-17 rule | The dealer rule *is* the automation of the only decision the card asks. |
| The collection / meta layer | A 10-pile randomized Draft Shop | Out of scope by the handoff doc's own framing. Slots change *which* piles appear and nothing else, so it drops in later without touching card logic. |

Fusion, the auction, and the Mythic tier were **not** cut — the source
architecture doc suggested deferring them, but each has a cheap correct
implementation once the instance model and the effect queue exist, and cutting
them would have left ~10 catalog holes for no real saving.

## 12. What the build actually produced

| | |
|---|---|
| Cards | **534 definitions + 25 auras**, catalog validator clean |
| Tests | **589 passing, 32 files**, every one citing a numbered behavior |
| Typecheck | `tsc --noEmit` clean under `strict` |
| Coverage | all **120** spec behaviors cited by at least one test |
| Bundle | 610 kB, 148 kB gzipped — mostly the catalog |

Two bugs are worth knowing about because both were *silent* — the suite was
green and the game looked fine while each was live:

- **`{op:'choose'}` resolved to nothing** (SB-43). Two rival resume
  implementations existed; the reachable one read a field the choose op never
  wrote. Seventeen "choose one" clauses across a dozen cards paid out their stat
  lines and skipped their choice. Nothing looked broken.
- **A prompt chain had no cycle guard** (SB-42). The node budget is counted
  within one resolution and every resume starts a fresh one, so the one
  recursion path the depth cap does not cover was the one nothing covered.

Both are the same lesson: the dangerous defect in a system this size is not the
one that crashes, it is the one that quietly does half the work.

### The catalog audit found nine more of exactly that shape

A later pass read all 533 cards against Appendix A/B and had every finding
adversarially verified: **263 confirmed defects, 175 fixed in card data**, the
rest recorded in SB-44 through SB-53. Not one of them crashed. The suite was
green and `tsc` was clean for every one.

The pattern is worth stating plainly, because it is what this codebase does when
it goes wrong: **two implementations of the same thing, and the reachable one is
the incomplete one.**

- `core/resume.ts` probes for a `resumePrompt` that `@engine/effects` never
  exported, so every prompt resolved through a local fallback that never
  substituted the player's pick. 37 of 42 Discovers threw the choice away.
- `fireOwnedTriggers` documented that it covered the Field and did not, so the
  entire Celestial aura tier was inert — along with the five Anomalies whose
  only effect is to grant one.
- `meta/scoring.ts` has an End of Game scorer that nothing calls; `endgame.ts`
  scores through `core/scoring.ts`.
- The uniqueness checks ran against the registry, which deduplicates — so they
  could not fail, and twelve cards shipped defined twice with the wrong one
  winning by module import order.

The lesson for anything added from here: **a check that runs downstream of the
thing that hides the problem is not a check.** `cards:validate` now reads the
authored catalog rather than the registry, refuses an unregistered `count()`
filter name (a silent zero), and verifies the Prophet Shop id list resolves.
`test/audit-regressions.test.ts` pins the engine fixes; every test in it fails
without its fix and passed the whole build without it.

## 13. How this was built: fullsend

Eleven builders and four spec-testers ran in parallel with the compiler off,
against a frozen spec and a frozen type surface (`src/engine/types.ts`, written
before any agent launched). Testers held only the spec and never saw the
implementation, so the suite arbitrates rather than ratifies. Collisions were
resolved by score with one winner and N deletions, then the build went green
once, then everything no test and no spec line reached was deleted.

The type freeze is the load-bearing part. Signature drift is the failure
parallelism causes most and reconciliation fixes most slowly, so the interface
was made real — as a file every slice imports — before anyone started writing.

The numbers, for anyone judging whether the method paid:

| Phase | Result |
|---|---|
| 2 — full send | 11 builders + 4 testers, 47,385 lines, every slice `BUILDS-RUN: 0` |
| 3 — contact | **10 type errors and 34 failing tests** out of 574 |
| 4 — reconcile | 6 collision clusters, one winner each, **−857 lines** |
| 5 — green | 5 fix agents, directory-disjoint, 574/574 |
| 6 — cull | **−2,768 lines**, suite never went red |

Ten type errors from 47,000 lines written blind is far below what this method
normally produces, and the reason is the type freeze. Broken imports and
signature drift are the two largest Phase 3 error classes and both were removed
by construction — every slice imported the same real file. The same freeze is
why 540 of 574 tests passed at first contact despite the testers never seeing the
implementation: both sides were written against one contract rather than two
readings of a prose spec.

What that leaves is behavioral damage, which is the damage worth having. The
failures that remained were real disagreements about how the game works, not
about what things are called.

Run artifacts live in `.fullsend/` and are gitignored: `SPEC.md`, `damage.md`,
`notes/*.assumptions`, `notes/reconcile-decisions.md`, and `notes/cull-report.md`.
