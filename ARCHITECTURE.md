# Jlore Jlards — Architecture

How this thing is built and why. Written for a hobby project: **me and 2–3 friends, playing from different houses, nobody is attacking it.**

---

## 1. Scope

**Goals**

- 2–4 people play a game of Jlore Jlards from different locations.
- You can't see your opponent's hand or anybody's library by just looking at the screen or poking around devtools.
- Someone shares a link in Discord, everyone clicks it, game starts. No accounts.
- I can add and tweak cards without touching engine code.

**Explicit non-goals** — these are not "later", they're *no*:

| Not doing | Why |
|---|---|
| Anti-cheat | It's my friends. If someone reverse-engineers the relay protocol to peek at my library, they've earned it. |
| Accounts, login, auth | A room code in a URL is the entire identity system. |
| Matchmaking, lobbies, ranked, chat | We're already in a Discord call. |
| Server-authoritative rules | Doubles the work for a threat model that doesn't exist here. |
| Spectators, replays, tournaments | No. |
| Mobile-first layout | Desktop browser. If it works on a phone, nice. |
| Scaling | Peak concurrency is 4. |

**The one hard requirement that shapes everything:** hidden information should be *actually absent* from a non-host player's browser, not just hidden by CSS. That's cheap to achieve and it's the difference between a card game and a spreadsheet.

---

## 2. The whole idea in one picture

One browser — the host's — runs the game. Everyone else runs a dumb terminal that renders whatever it's told and sends button presses back. The server is a message queue that has no idea what a card is.

```mermaid
flowchart LR
    subgraph Host["Host browser (whoever starts the game)"]
        E[Engine<br/>full game state]
        F[View filter]
        E --> F
    end

    R[("Vercel relay<br/>+ Redis list<br/>(opaque messages)")]

    subgraph P2["Friend 2"]
        V2[Renders view<br/>knows only their hand]
    end
    subgraph P3["Friend 3"]
        V3[Renders view]
    end

    F -- "filtered views" --> R
    R --> V2
    R --> V3
    V2 -- "intents" --> R
    V3 -- "intents" --> R
    R --> E
```

**Why this gets the hidden-info property for free:** Friend 2's browser is never *sent* the library or Friend 3's hand. There's nothing to find in devtools because the data never crossed the wire. No encryption, no validation, no auth — just don't send it.

The host sees everything, obviously. The host is a person I know.

---

## 3. What runs where

| Piece | Where | Notes |
|---|---|---|
| Rules engine | Host's browser | Pure function, no I/O |
| Card definitions | Bundled with the client | Static JSON, ~400 cards |
| View filtering | Host's browser | Runs after every state change |
| Message relay | Vercel Function + Redis | ~40 lines, knows nothing about the game |
| Rendering + input | Every browser | Same client code; host just also runs the engine |
| Codex / settings | Each browser's localStorage | Never leaves the device |
| Seat identity | A cookie | So a refresh puts you back in your seat |

---

## 4. The engine

Everything good about this architecture comes from one decision: **the engine is a pure function with no I/O, no framework, no network awareness.**

```js
// engine/index.js
export function reduce(state, action, rng) -> newState
```

That's the whole public surface. It doesn't know it's in a browser, doesn't know there are other players, doesn't fetch anything. Consequences:

- **Testable without any infrastructure.** Feed it an action list, assert on the state. No mocks, no server running.
- **Hotseat works before multiplayer exists.** Same function, one browser, no relay.
- **Multiplayer is a transport swap.** If I ever want a real server, the same `reduce` moves into the Vercel function untouched.
- **Bugs are reproducible.** Which, with this card pool, is the actual reason.

### 4.1 Seeded randomness — non-negotiable

**No `Math.random()` anywhere in `engine/`.** Ever. Every random pull goes through the injected `rng`: Egg drop tables, Grapevine's 79/20/1 split, Highroller flips, Lead's per-turn cost reroll, Too Many Stats, and every "random card from the Entire Universe."

The reason isn't security here — it's that "the Grapevine did something weird and then Misery replayed it" is completely unreproducible otherwise, and I will hit that constantly. With a seed, I paste `(seed, actionLog)` into a test and watch it happen again.

```js
// engine/rng.js — mulberry32, ~5 lines, deterministic
export function makeRng(seed) { /* ... */ }
```

Add an ESLint rule banning `Math.random` under `engine/`. It will save an evening.

### 4.2 State shape

```js
{
  seed, turn, activePlayer,
  players: {
    [id]: { library:[], hand:[], gy:[], play:[], field:[],
            money, buys, actions, prophet, vp }
  },
  shop:    { resource:{}, points:{}, prophet:{}, draft:[ /* 10 piles */ ] },
  anomaly: null | AnomalyId,
  pending: null | { type:'discover', player, options, prompt },
  log:     [ /* every action, in order */ ]
}
```

Cards in zones are **instances**, not IDs — they carry their own counters (Plague tokens, Lection's play count, Relic upgrades, per-instance VP) and flags (Flimsy, Temporary). That's the three-level identity model from the design doc; skipping it means Universal Buff! and Quick Patch can't coexist.

### 4.3 Prompts are state, not callbacks

~60 cards Discover. The engine can't `await` a click. So a prompt is a **field in the state**:

```js
state.pending = { type:'discover', player:'p2', options:[a,b,c] }
```

The engine returns with `pending` set and stops. The UI sees it and renders a picker. The choice comes back as a normal action (`{type:'resolve', choice:1}`) and `reduce` continues. Same mechanism whether the picker is local or three states away — which is why multiplayer doesn't need special-casing for card prompts.

---

## 5. The view filter

The only security in the system, and it's about 30 lines.

```js
// engine/view.js
export function viewFor(state, playerId) {
  return {
    you: {
      hand:    state.players[playerId].hand,      // full detail
      field:   state.players[playerId].field,
      money, buys, actions, prophet, vp,
      libraryCount: state.players[playerId].library.length,   // count only
      gy:      state.players[playerId].gy,        // public anyway
    },
    others: mapValues(otherPlayers, p => ({
      handCount:    p.hand.length,                // count only
      libraryCount: p.library.length,             // count only
      gy: p.gy, field: p.field, vp: p.vp, ...     // public
    })),
    shop: state.shop,                              // fully public
    turn, activePlayer, anomaly,
    pending: state.pending?.player === playerId ? state.pending : { waitingOn: state.pending?.player }
  };
}
```

**Rules I'm enforcing here:**

- Libraries are counts, never contents. Not even your own — otherwise the whole draw mechanic is pointless.
- Other players' hands are counts.
- `pending` only ships its options to the player who has to choose. Otherwise a Discover leaks three cards to everyone.
- Ascendant Spread's secret VP value stays a number only its owner sees.
- The Call to Chaos "add an unknown card to the top of your library" entries send the *display text*, never the resolved card. Four different outcomes share one string on purpose.

One test worth writing and never deleting:

```js
test('a view never contains library contents', () => {
  const v = viewFor(state, 'p2');
  expect(JSON.stringify(v)).not.toContain(secretCardInP3Library.instanceId);
});
```

---

## 6. The relay

A message queue that has never heard of a card game.

```
POST /api/room/[code]                  → RPUSH + EXPIRE 6h + PUBLISH (one pipeline), return new length
GET  /api/room/[code]?since=N          → LRANGE N..-1
GET  /api/room/[code]?since=end        → { messages: [], next: LLEN }
GET  /api/room/[code]?stream=1&since=N → text/event-stream, one event per entry, pushed via pub/sub
```

That's the entire backend. Vercel Function + Upstash Redis, both free tier. Messages are opaque JSON blobs; the relay doesn't parse them, doesn't validate them, doesn't know who's the host.

**Since SB-65, every browser runs the engine (lockstep).** The owner waived hidden information for playtesting, so the relay no longer carries filtered views. It carries one `start` message and then intents, and every browser folds that list through `reduce` in relay order. `reduce` is pure and seeded (B119) and RPUSH order is a total order, so they all land on the same state; a checksum each turn catches anything that does not.

**Message envelope:**

```js
{ seq, from: seatId, kind: 'intent' | 'view' | 'hello' | 'snapshot', payload }
```

- `intent` — `{nonce, actions}`: a player pressed a button (or a batch of them). Every browser applies it; the actor is the seat bound to `from`, never a field of the payload.
- `view` — the lobby roster, broadcast (`jlore-lobby/1`). No game views ride the list any more.
- `hello` — presence in the lobby, every 4s, carrying the seat's name and (once) its Codex. After the deal it only matters for a resumed match with open seats: the first hello from an unbound seat claims the next one.
- `snapshot` — tagged payloads: `jlore-start/1` (the deal), `jlore-check/1` (the host's checksum at a turn boundary), `jlore-resync/1` / `jlore-state/1` (a client that could not rebuild its way back into agreement asks for, and adopts, the host's state).

**Push, with polling behind it.** Polling at 1 s was chosen because "nobody notices a second in a turn-based game". They did: a press cost two polls and two round trips, about 1.8 s on your own screen. A press now renders locally before it is posted, and other browsers hear about it over server-sent events backed by Upstash pub/sub — about 0.1-0.2 s on the dev relay. A stream ends itself after ~50 s to fit the 60 s function budget and the client reopens from its cursor. If streams cannot be opened, the same loop polls: 1 s at rest, 250 ms right after traffic, no hidden-tab backoff during a match, and an idle stop that a click or the tab coming back undoes.

### Why not WebRTC

Trystero/PeerJS would remove the relay entirely and run on GitHub Pages. Skipping it because WebRTC fails on some home and corporate networks in ways that are opaque to debug — and "Dave can't join and neither of us knows why" is a worse problem for a casual game than paying $0 for a Vercel function. The relay works on every network, always.

---

## 7. Browser storage

Three tiers, and the split matters more than it looks.

| What | Where | Size | Why there |
|---|---|---|---|
| Seat token + room code | **Cookie** | ~100 bytes | Survives refresh, so reloading puts you back in your seat instead of joining as a new player. Small enough that riding along on every relay request costs nothing. |
| Codex (seen cards), settings, last snapshot | **localStorage** | KBs–MBs | Persistent, per-device, and **never sent anywhere**. |
| Live game state | **In memory** | — | Rebuilt by replaying the room's relay list (SB-65). Nothing to persist. |

**On putting the library in a cookie specifically:** don't. Cookies cap around 4KB and get attached to *every single HTTP request*, so a 40-card library would be shipped to the relay a thousand times a session — the opposite of private. localStorage holds 5MB and never leaves the browser on its own. Use the cookie for identity, localStorage for data.

```js
// storage.js
setCookie('jlore_seat', seatId, { maxAge: 60*60*8, sameSite: 'Lax' });

localStorage.setItem('jlore_codex', JSON.stringify([...seenCardIds]));
localStorage.setItem('jlore_snapshot', JSON.stringify({ code, seq, state }));
```

**Codex / Known Universe** lives entirely in localStorage. It's a set of card IDs, appended whenever a card appears in a match you're in. ~60 cards Discover from "the Known Universe," so the engine needs it synchronously — each seat's Codex goes up in its first lobby `hello`, and the host puts all of them in the start message, so every browser deals the match with the same codices. Clearing your browser resets your Codex; for a hobby build that's a fine tradeoff against building account storage.

---

## 8. Room lifecycle

**Starting:** host generates a 6-char code, opens `#JLORE-4821`, pastes it in Discord. This opens a **lobby**, not a match — no RNG is seeded and no cards exist yet. The host holds the room open while people arrive, then presses Start, and the match is created for exactly the people in it (SB-64).

**Joining before the deal:** open the link → client sends `hello` with your seat token (from cookie, or freshly generated) and Codex, and repeats it every 4s → you appear in the host's roster within about a poll each way. The lobby host broadcasts the roster on every change; it never touches the engine.

**Dealing:** the lobby freezes its roster and hands over an ordered list of seat tokens, names and codices. The host posts one `start` message carrying those plus the config, seed and a checksum; `seats[i]` acts for `playerOrder[i]`. Every browser builds the identical match from it — the host applies it at once, without waiting for its own post — so nobody needs a hello round trip to get seated.

**Joining after the deal:** the final lobby broadcast carries `started: true` and the frozen seating order, so a latecomer gets a definite answer rather than a timeout: their token is in the list (a reconnect — they replay the room and are back) or it is not (the match was dealt without them, and the screen says so).

**Refresh:** the cookie restores your seat token; the room is read from its first message and replayed, and you're back where you were. The host too: after the deal the host is just another client of its own room, so a host reload is a rejoin into seat one, not a resume on a new room code.

**Host closes the tab:** the match goes on for everyone else — every browser has the state. Only the turn-boundary checksums stop until the host comes back. No full-state snapshot is posted to the relay; a local one is kept (off the click path) for the start screen's resume.

---

## 9. A turn, end to end

1. Friend 2 clicks "play Temple Marketplace."
2. Their browser runs `reduce(predicted, {type:'play', …})` and renders `viewFor(predicted, p2)` at once: the Discover picker is up in the same frame.
3. It `POST`s `{kind:'intent', payload:{nonce, actions:[{type:'play', …}]}}`.
4. The relay appends it and publishes; every open stream reads it and pushes it out.
5. Friends 1 and 3 run the same `reduce` on the same state and see "waiting on Friend 2." Friend 2's browser sees its own intent come back in order and keeps the state it already computed.
6. Friend 2 picks → `{type:'resolve', …}` → back to step 2.

Latency: the presser, one render (~50-130 ms on the dev relay, most of it React); everyone else, one POST plus one push (~0.1-0.2 s on the dev relay).

---

## 10. Repo layout

```
/engine           ← pure, no I/O, no React, no fetch
  index.js          reduce()
  rng.js            seeded PRNG
  view.js           viewFor()
  effects/          the effect-node interpreter
  zones.js, shop.js, prophet.js, auras.js
/cards
  *.json            card definitions, data only
  schema.json
/net
  relay.js          poll loop + POST
  host.js           runs the engine, publishes views
  client.js         renders views, sends intents
/ui                 React components
/api
  room/[code].js    the entire backend
/test
  engine.test.js
  view.test.js      ← the leak test from §5
```

The boundary that matters: **nothing in `/engine` imports from `/net`, `/ui`, or `/api`.** Enforce it with an import lint rule. That boundary is what keeps the transport swappable and the tests trivial.

---

## 11. Cards as data

~400 cards. Hand-scripting each one doesn't work, so cards are JSON and the engine interprets them.

```jsonc
{
  "id": "temple_marketplace",
  "cost": { "money": 6 },
  "types": ["Action"],
  "rarity": "rare",
  "keywords": [],
  "stats": { "actions":1, "buys":1, "cards":1, "money":1, "prophet":1 },
  "effects": []
}
```

**`stats` is separate from `effects` on purpose.** Buff/Nerf picks a random base stat and ±1s it — if "+1 Money" is buried inside a scripted effect blob, Buff can't find it. Plain stat lines go in the structured object; only non-stat behaviour goes in `effects`.

Add cards by adding JSON. No engine changes unless a card needs a genuinely new effect op.

---

## 12. Build order

Each step is playable on its own, which is the point.

| Step | What | Feels like |
|---|---|---|
| 1 | Engine + ~40 cards + hotseat in one browser | A real (small) game |
| 2 | Relay + host/client split + view filter | Actually playing with friends |
| 3 | Add cards in bulk | The game fills out |
| 4 | Prophet shop, Auras, Anomalies | The interesting parts |
| 5 | Whatever's still fun to build | — |

**Vertical slice for step 1:** the Felinor cards. ~15 of them, covering tokens, trash triggers, giving cards to opponents, and a Points payoff — enough to shake out core-engine bugs before there are 400 cards to regress.

**Deliberately deferred, probably forever:** Fusion (Matchmaker, Freaky Phil, What is Love?, Frankenstein), the blind auction (Glubby Gloob), the "reality where you win" cards (Infinite Realities, Second Time Around, Zephrys), Arc of the Universe, Counting Cards, A Duel of Wits. Together they're a disproportionate share of total build cost for ~10 cards. Ship without them.

---

## 13. Known weaknesses, accepted

| Weakness | Why it's fine |
|---|---|
| Host closes tab → game over | It's an hour-long session with people I'm on a call with |
| Host's browser can see all state | The host is a person I know |
| Every browser holds the full state, so a determined player can read every hand and library with devtools (SB-65) | Waived by the owner for playtesting; the UI still renders only `viewFor` |
| Host does all the compute | Peak is 4 players and a few hundred effect nodes |
| Clearing browser data wipes your Codex | Building account storage costs more than it's worth here |
| No reconnect if the *relay* dies | Vercel + Upstash going down mid-session is not my problem to solve |

**If the host-dependency ever gets annoying**, the upgrade path is short: move `reduce` into `/api/room/[code].js`, keep state in Redis, and the server becomes authoritative. Same engine code, unchanged. That's the entire dividend from writing it as a pure function.
