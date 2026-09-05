# Jlore Jlards — Gameplay & Card Handoff

**Scope:** the game itself — rules, cards, and how to build them. The collection/meta layer (Card Slots, Reservations, Formations, packs, progression) is **deliberately out of scope for this pass**; the Draft Shop is treated as a randomized kingdom instead. The Codex, the Known/Entire Universe distinction, and rarity are kept, because cards read from them during play.

**Source of truth:** the "Jlore Jlards" design doc. Where it is silent or self-contradictory, this document proposes a resolution and marks it `[PROPOSED]`. Unresolved blockers are marked `[OPEN]`.

---

## Contents

1. [Snapshot](#1-snapshot)
2. [Core rules](#2-core-rules)
3. [Keyword glossary](#3-keyword-glossary)
4. [Currencies and stats](#4-currencies-and-stats)
5. [The shops](#5-the-shops)
6. [Codex and the two Universes](#6-codex-and-the-two-universes)
7. [Rarity](#7-rarity)
8. [Win conditions and Anomalies](#8-win-conditions-and-anomalies)
9. [Auras](#9-auras)
10. [Card data model and effect DSL](#10-card-data-model-and-effect-dsl)
11. [Subsystem inventory](#11-subsystem-inventory)
12. [Architecture notes](#12-architecture-notes)
13. [Build order](#13-build-order)
14. [Open questions](#14-open-questions)
- [Appendix A — full card catalog](#appendix-a--full-card-catalog)
- [Appendix B — sub-catalogs](#appendix-b--sub-catalogs)
- [Appendix C — referenced but undefined](#appendix-c--referenced-but-undefined)

---

## 1. Snapshot

A digital deck-builder in the Dominion lineage, 2–4+ players, with three additions that change how it actually plays:

| Pillar | What it does |
|---|---|
| **Prophet economy** | A second currency that never resets, with its own shop of high-impact cards gated by *thresholds* rather than money. It's a parallel track you invest in across the whole game. |
| **Anomalies** | ~50% of matches roll a global rule-warping modifier — extra resources, altered starting decks, changed win conditions, or a full elemental subsystem. |
| **Auras** | Persistent per-player enchantments in a Field zone: Heroic (activated, repeatable), Celestial (passive), Hypercelestial (rare, match-defining). |

Underneath that, three properties make the cards themselves unusual to implement: heavy **generative randomness** (Discover, "random card from the Entire Universe", Fusion, Buff/Nerf), **persistent per-card state** (cards that count their own plays across the whole game), and **live card text** (cards that print their own counters into their rules box).

**Setting, for copy and art:** 2,000 years in the future, reality is unravelling. An order blessed by the **Chron Sovereign** sends the player — a lone **Navigator** — back through time with the **Stellar Codex** to mend anomalies. Opponents are **Echoes**: rival Navigators from divergent futures. The **Ebon Sovereign** is the corrupted antagonist, a once-radiant ruler whose ambition curdled into endless hunger.

The fiction maps onto the mechanics cleanly — player = Navigator, collection = Codex, opponents = Echoes, match modifiers = Anomalies, Prophet = Sovereign favor. Keep that mapping in UI copy.

---

## 2. Core rules

### 2.1 Zones

| Zone | Notes |
|---|---|
| **Library** | Face-down draw pile. |
| **Hand** | 5 cards by default. **Hand has an order, and adjacency matters** — Loaf of Bread plays "the cards that sandwich this", Brownie "loses Flimsy if on the edge of your hand", Feel so Clean discards "adjacent cards". Model hand position; let players reorder. |
| **Play area** | Cards resolve here, then go to GY. |
| **GY** | The doc says "GY" and "discard" interchangeably — **they are the same zone.** Normalize to GY internally, display "Discard". |
| **Trash** | Permanent removal, no recovery. |
| **Field** | Holds Auras. Auras are not cards. |
| **Shop** | Public piles. Piles are **ordered stacks, not counters** — the top card matters (Water Into Swine, Crop Dusting, Supernova, Chron Caché, The Big Backening, Missed Vintage). |
| **Deck** (aggregate) | Library + Hand + GY + in-play. Every "cards in your deck" scoring card reads this. |

### 2.2 Setup

- Starting deck: **7 Copper + 3 Tix**.
- Opening hand: **5**.
- Anomalies can override this (Miniature Deck, Economic Hedge, Xushi's Game).

### 2.3 Turn structure

```
START OF TURN
  ├─ tick delayed effects ("next turn", "in N turns", countdown auras)
  ├─ start-of-turn aura triggers
  ├─ reset: Actions = 1, Buys = 1, Money = 0   (± anomaly / carryover modifiers)
  └─ start-of-turn card triggers

MAIN PHASE  — a single interleaved phase, NOT Dominion's action-then-buy split
  ├─ play Resource cards   → free, no Action cost
  ├─ play Action cards     → 1 Action (or N for Big Action N)
  └─ buy cards             → 1 Buy + the Money cost; bought card → GY
                             (unless Play on Buy, Express Shipping, etc.)

END OF TURN
  ├─ end-of-turn triggers (CN Developer, Potato transform, Cornucopia, Milkshake)
  ├─ discard hand → GY
  ├─ draw 5 (modified by anomalies / auras / "+N cards next turn")
  └─ Money and Buys reset
```

**The interleaving is load-bearing.** *Express Shipping* ("the next card you buy this turn goes to your hand"), *Firesale* ("if it is an Action card, play it"), *Venture Backed* ("if you gained 3+ cards this turn"), *The Big Backening*, and *Frankenstein* all require buying and playing to alternate freely. Do not implement a rigid phase split.

**Draw timing:** the hand is drawn at the *end* of the turn. Every "at the start of your next turn, add X to your hand" effect therefore lands in an already-drawn hand, temporarily pushing it above 5.

### 2.4 Shuffle rule

- Empty Library + a draw → shuffle GY into Library.
- **Cards played this turn cannot reshuffle in on the same turn.** [PROPOSED] tag each instance with `playedOnTurn`; the shuffle routine holds those aside and returns them to GY afterward.

### 2.5 End of game

The doc gives two triggers:

| Rule | Where |
|---|---|
| 4 shop piles empty, OR the Jlore pile empties | "Win Conditions → Standard" |
| The Jlore pile empties, OR the pile that brings **40% of Draft Shop piles** to empty | "MECHANICS" |

`[OPEN]` which is canon. **[PROPOSED]** make it config: `emptyPileThreshold` as a fraction (default 0.40) with an optional absolute override (4). Variants set it.

**Critical timing:** *"the game ends at the start of the turn of the player who emptied the pile."* Play continues around the table and stops only when it wraps back to the triggering player, so everyone gets equal turns. Implement as: on trigger, record `endTriggeredBy`; at the start of each turn, if `activePlayer == endTriggeredBy && endTriggered`, end the game before any start-of-turn effects fire.

**Winner:** most Victory Points. `[OPEN]` no tiebreaker specified. **[PROPOSED]** fewest turns taken, then smallest deck, then shared win.

### 2.6 Rules quick-reference (from the doc's own MECHANICS list)

Draw 5 to start · starting deck 7 Copper + 3 Tix · end of turn discard hand and +5 Cards · Resources cost no Action · Actions cost 1 Action · played cards go to GY · 1 Buy per turn · bought cards go to GY · empty Library reshuffles GY · cards played this turn can't reshuffle this turn · Prophet cards need a threshold and drain that much Prophet · Money and Buys reset each turn (Prophet does not) · Locked piles can't be bought from · trashing is permanent · **Flimsy** = trashed when played · **Temporary** = trashed when played or discarded.

---

## 3. Keyword glossary

Each of these needs to be an engine concept, not per-card scripting.

### 3.1 Card-state keywords

| Keyword | Meaning | Notes |
|---|---|---|
| **Flimsy** | Trashed when played. | Printed, or granted at runtime (Corrosion, Book of Blood, Alien Dropshipping, Fading Blossom anomaly). Instance flag; removable by Card Sleeve, Goatman Family Genetics, the Combo 3 clauses on Second-Degree Forgery and Petty Theft. |
| **Temporary** | Trashed when played *or* discarded. | Strictly stronger than Flimsy. Removable by Card Sleeve and Archivist. |
| **Indestructible** | Cannot be trashed. Series E/F/X Funding only. | Must beat every trash source. `[OPEN]` Indestructible + Flimsy deadlock — **[PROPOSED]** Indestructible wins, card goes to GY. |
| **Unfathomable** | On Prophesized Jlore only. Undefined. | **[PROPOSED]** excluded from all Discover / random / copy / steal pools. Consistent with its own rider: "If obtained through any other means, TRASH THIS." |
| **Play on Buy** / **Cast on Buy** | Same thing under two names. Resolves on purchase, then GY (or trashed if Flimsy). Costs no Action. | **Pick one keyword.** Recommend `PlayOnBuy`. |
| **Play on Draw** / **Cast on Draw** | Resolves when drawn. | Recursion risk: a Play-on-Draw card that draws. Cap depth. |
| **Locked** | Pile cannot be bought from. Already-locked piles can't be locked again. | Locks carry duration + owner. Cloud Nine clears all. |
| **Pointed to** | Pointer's binding — the two cards are Played/Mutilated/Trashed together. | `[OPEN]` **Mutilate is never defined anywhere in the doc.** |
| **Fused** | Two or more cards merged into one composite. | Matchmaker, Freaky Phil, What is Love?, Frankenstein, Heroic Aura Mycology. |

### 3.2 Action keywords

| Keyword | Meaning | Notes |
|---|---|---|
| **Discover** | Offer 3 from a defined pool, player picks 1. | The most-used mechanic in the game — ~60 cards. Pools are always scoped (Known Universe / Entire Universe / your deck / an opponent's library / a rarity / a type / a cost band). Build one generic weighted sampler. |
| **Recruit** | `[OPEN]` never defined. Used as a verb *and* as a numeric stat ("Recruit X"). | **[PROPOSED]** `Recruit(zone=Library, filter, n=1)` → move n matching cards to hand, then shuffle the source. "Recruit X" as a stat = recruit X cards of your choice. |
| **Buff** | Pick a random base stat (Money, Buys, Actions, Cards, Points) and +1 it **permanently**. | Universal Buff! hits *all copies wherever they are*; Quick Patch hits one instance. This forces the definition/pile/instance split in §10.1. |
| **Nerf** | Same, −1. | |
| **Upgrade** | Two meanings: Resources step up (Copper→Silver→Gold→Diamond); Relics permanently +1 their own stat. | Disambiguate as `UpgradeResource` vs `UpgradeRelic`. Pennymelting uses **downgrade**. |
| **Transform** | Replace a card in place. Same zone, same position. | Not trash + gain — trash triggers must not fire. |
| **Manifest** | Put an Aura into your Field. | |
| **Mill** | Top N of Library → GY. | Fast Life only. |
| **Cycle** | Draw a card. | HR Trainee only. |
| **Steal** | Move a card from an opponent's zone to yours. | Often actually "add a copy" — the doc is inconsistent card to card. Read each one. |
| **Combo N** | Conditional: triggers if this is at least the Nth card you've played this turn. | Per-turn counter. Resettable (Crime Wave). Copyable (Wombo Combo permanently steals another card's Combo clause). |
| **Big Action N** | `[OPEN]` **never defined.** On 11 cards. | **[PROPOSED]** playing it costs **N Actions instead of 1**. Reads correctly against the payoffs (Vault = 5 Actions for two Diamonds) and gives the +Actions archetype a sink. |
| **Plague Token** | A counter on a specific card instance, in *any* zone including shop piles. | Persists through zone changes. |
| **End of Game** | Type modifier: scores only at final scoring, explicitly excluded from the running VP total. | Constellation, Star Aligner. Running VP and final score are two different computations. |

---

## 4. Currencies and stats

### 4.1 Base stats

Buff/Nerf enumerates them: **Money, Buys, Actions, Cards, Points**. Anything Buff can touch must be a structured numeric field, not prose.

| Stat | Resets | Notes |
|---|---|---|
| Money | Each turn | Goes negative (Loan Shark, Generational Aura Debt, Outstanding Debt, Reckless Investment). Can carry over (Smart Savings). |
| Buys | Each turn | |
| Actions | Each turn | Default 1. |
| Cards | n/a | "+N Cards" = draw N. |
| Victory Points | Never | Lives on cards; can be negative. Can accrue *onto a specific instance* (Tixatus, Oh Mr. Lebon, Skyscraper, Ascendant Spread — the last is hidden from opponents). |
| **Prophet** | **Never** | The persistent second currency. |

### 4.2 The Prophet economy

Notation: `Name (−C) — Prophet T`.
- **T** = threshold. You need at least T Prophet banked to buy at all.
- **C** = drain. Buying removes C Prophet.

So *Ebon Blade (−3) — Prophet 5* needs 5 banked and costs 3. *Tnack Trav (0) — Prophet 16* needs 16 banked and costs nothing — a pure "did you commit" gate. *Prophesized Jlore (−30) — Prophet 30* is the terminal payoff at +100 VP.

- Prophet costs no Money and no Buy. `[OPEN]` does a Prophet purchase consume a Buy? **[PROPOSED]** no — the threshold is the limiter.
- Prophet is floor-clamped at 0. *The Unconcerned Lion* ("you can go into Prophet debt to buy this") is the single explicit exception.
- Prophet generation is a full archetype: Novice Acolyte, Prophet Injection, Perish Priest, Mythmaker, Pomegranate, New Canon, Lection, Meditation, Sleep Preacher, Money Church, Temple Marketplace, Feel so Clean, Book of Conspiracy, Heroic Aura Dead Sea Scroll, Miracle Fruit.

### 4.3 Negative-cost cards

- **Series A–X Funding** cost (−1) to (−7): buying **pays you** and saddles you with negative VP. They self-lock for a turn.
- **Chopped Chuzz** (−1).
- **Lead** rerolls its cost between (−2) and (10) each turn and pays out Money equal to its current price.

Engine: `cost` is a signed integer; purchase resolves as `money -= cost`, so negative costs credit. Every cost modifier (Dynamic Pricing, The Jlore Must Flow, Cup Runneth Over, Throttle Markets, Price Fixing, Discount Coupon, Miracle Prep, Nickel and Dime, Invisible Hand, Accel Giant, Giant's Aid, Professor of Curvature) needs its own floor — the doc specifies different ones ("minimum 0", "Minimum (1)").

---

## 5. The shops

| Shop | Contents |
|---|---|
| **Resource Shop** | Copper (0), Silver (3), Gold (6), Diamond (10) |
| **Points Shop** | Tix (2), Robux (5), Jlore (8). **The Jlore pile emptying ends the game.** |
| **Prophet Shop** | ~24 fixed cards gated by Prophet threshold |
| **Draft Shop** | The rotating kingdom |

**Draft Shop composition, without the meta layer** — the design doc builds this from per-player Card Slots, which is out of scope here. **[PROPOSED] interim rule:** the Draft Shop is **10 randomized piles**, Dominion-style, drawn from the Entire Universe with rarity weighting (§7), no duplicate piles. Scale with player count if playtesting wants a wider board (`5 × playerCount` reproduces the doc's original density). This is a placeholder that keeps every card playable; the slot system slots back in later without touching card logic, since it only changes *which* piles appear.

**Pile sizes** are never specified anywhere in the doc. **[PROPOSED]** size by rarity — Common 10 / Rare 8 / Epic 6 / Legendary 4 / Mythic 1. The Accelerated (−40%) and Prolonged (+40%) Anomalies scale it. Basic Resource/Points piles get large fixed counts scaled by player count.

---

## 6. Codex and the two Universes

The Codex is the player's record of cards. It stays in scope because ~30 cards read from it during play.

| Scope | Definition | Notes |
|---|---|---|
| **Known Universe** | Cards in your Codex, or that you have seen in a game before. | **Per-player and persistent across sessions.** A "Discover from the Known Universe" produces different options for different players at the same table. This is profile-level data, not match state. |
| **Entire Universe** | Every card in the game. | |
| **Unknown Universe** | Used once in MECHANICS, defined as "all cards in the game". | Almost certainly a typo for Entire Universe. **Delete the term.** |

**Implementation:** the Codex is a per-account set of card IDs, appended to whenever a card enters a match the player is in (seen in a shop, drawn, played by anyone, revealed). It needs to be readable synchronously during effect resolution, so cache it into match state at match start rather than querying live.

**Design consequence worth flagging:** a new player's Known Universe is small, so their Known-Universe Discovers offer fewer and worse options than a veteran's. That's either a progression feature or a new-player trap depending on how you seed it. **[PROPOSED]** seed every account's Codex with the full Common + Rare pool so Known Universe is never punishing, and let Epic/Legendary/Mythic accumulate through play.

---

## 7. Rarity

The doc uses rarity constantly and defines it nowhere. It names **Common** (Pauper No Longer), **Rare** (Blueberry Pie, Iced Up), **Epic** (Epic Fate, Purple Rain), **Legendary** (Legendary Destiny, Golden Grape, Idol of the False God, Soul Shard Lapidary), and **Mythic** (Call to Chaos). *Predatory Monetization* pulls "at Hearthstone card pack odds" and *Fuit Gummy* counts "each rarity among cards in your hand" — so rarity must be a queryable field on every card.

### 7.1 The ladder `[PROPOSED]`

| Tier | Role | Share of pool | Pile size | In-match pull weight |
|---|---|---|---|---|
| **Basic** | The 7 permanent shop staples. Always present, never in random pools. | — | scaled by players | — |
| **Token** | Generated only, never purchasable. | — | n/a | excluded unless named |
| **Common** | Simple, low-variance filler. Complexity T1–T2. | ~45% | 10 | 71.5% |
| **Rare** | Archetype enablers, one conditional clause. T2–T3. | ~30% | 8 | 22.9% |
| **Epic** | Swingy payoffs, subsystem interaction, build-arounds. T3. | ~17% | 6 | 4.4% |
| **Legendary** | Named characters and unique world-effects. T3–T4. | ~7% | 4 | 1.1% |
| **Mythic** | Breaks the game's normal bounds. Hard-gated. T4. | ~1% | 1 | 0.1% |

### 7.2 What rarity drives in play

Not a cosmetic — a live gameplay parameter:

1. **Random-pull weighting.** Without it, Wardrum's Bold Prediction, Xushi's Game, Supernova, and Book of Random are coinflips between Copper and Infinite Realities.
2. **Discover pool filtering.** Legendary Destiny, Epic Fate, Idol of the False God, Blueberry Pie, Golden Grape, Soul Shard Lapidary, and Predatory Monetization all Discover *by rarity*.
3. **Pile size** — rarer cards are scarcer contested resources.
4. **In-match counting** — Fuit Gummy (+1 Action per rarity in hand), Pauper No Longer (trash all Commons), Iced Up (discard Rares), Purple Rain (per Epic in hand).
5. **Complexity budget** — the design guardrail. A Common should never require a new subsystem; T4 complexity implies Epic or above.

### 7.3 Assignment heuristic used in Appendix A

- **Token** — never sits in a shop pile on its own.
- **Common** — pure stat line or one clause, no subsystem, cost ≤ 4.
- **Rare** — one conditional, or one subsystem touch, or an archetype's baseline enabler.
- **Epic** — multi-clause, subsystem-heavy, or high-swing. The top of most archetype curves.
- **Legendary** — a named character or a unique world-effect, usually one per archetype.
- **Mythic** — six cards only: Prophesized Jlore, Infinite Realities, Arc of the Universe, The Eternal Show, Chron Break, Doomsday Clock.

**"Legacy" is not a rarity.** ~30 cards carry a `Legacy` tag, and two cards (*A Gaze into the Past*, *A Glimpse of the Past*) pull "a random **Legacy** card from the Entire Universe" — making it a set/rotation marker, orthogonal to rarity. Keep it as its own field.

---

## 8. Win conditions and Anomalies

### 8.1 Match roll

| Roll | Chance |
|---|---|
| Standard (no Anomaly) | 50% |
| Anomalous | 20% |
| Formational *(shop-structure variants — out of scope this pass)* | 20% |
| Chaotic (Anomaly + Formation) | 10% |

With Formations cut, the interim split is **70% standard / 30% Anomalous**.

`[OPEN]` can multiple Anomalies roll together? Several are mutually exclusive. **[PROPOSED]** one per match, drawn from a tagged pool with mutex groups (`startingDeck`, `endCondition`, `startingAura`).

### 8.2 Win conditions

| Variant | End trigger |
|---|---|
| **Standard** | 4 shop piles empty, or Jlore empties |
| **Countdown** | After X turns, or Jlore empties |
| **Duel** | A player's deck holds X more VP than every opponent, or Jlore empties |
| **Crown** | A player's deck holds X VP, or Jlore empties |

Winner is most VP in all four. `X` is unspecified everywhere — expose as config. Several Anomalies and two cards (Project: Doomsday, Doomsday Clock) override the win condition entirely.

### 8.3 Anomalies

**Stat modifiers**

| Anomaly | Effect |
|---|---|
| Extra Buy! | +1 Buy per turn |
| Extra Gold! | +1 Money per turn |
| Extra Action! | +1 Action per turn |
| Extra Cards! | +1 Card per turn |
| Less Cards! | −1 Card per turn |
| Less Money! | −1 Money per turn |

**Starting deck** *(mutex)*

| Anomaly | Effect |
|---|---|
| Miniature Deck | 5 cards: 4 Copper, 1 Tix |
| Economic Hedge | 10 cards: 3 Copper, 3 Silver, 1 Gold, 3 Robux |
| Xushi's Game | 10 random Entire-Universe cards — **identical for every player** |

**Shop and pacing**

| Anomaly | Effect |
|---|---|
| Accelerated Game | Shop piles 40% smaller |
| Prolonged Game | Shop piles 40% larger |
| Cash Injection | At the start of turn 5, all Copper becomes Gold |
| Time Flail | Turns are 2.5× as fast (turn-timer modifier, not a rules change) |
| Dynamic Pricing | Shop costs doubled; −1 to all shop costs at end of each turn (min 0); a bought card's cost +3 |
| Fading Blossom | All cards gain Flimsy. Shop prices halved (round down). +5 Buys per turn |

**End condition** *(mutex)*

| Anomaly | Effect |
|---|---|
| Death's Door | Game ends at the end of turn `10 × playerCount`. Live countdown |
| Heavy is the Crown | Ends when a player leads by 10 VP |
| Aim for the Moon | Ends when a player reaches 20 VP |
| Battle Royale | 3+ players. Every 15 turns the lowest-VP player is eliminated. Last standing wins. Live countdown |

**Starting aura** *(mutex)*

| Anomaly | Grants |
|---|---|
| Double Header | Celestial **Double Header** — first buy each turn adds an extra copy to GY |
| Sasalele | Celestial **The Invisible Hand** — shop cards cost (2) less for you, min 0 |
| Adrenaline | Celestial **Kwzki's Stimulants** — +1 Action, +3 Cards per turn |
| Rule of Thirds | Celestial **Symphony of 3** — every third card you play triggers twice. Live counter |
| Onward to Victory! | Celestial **March of Progress** — start of turn, add a random Entire-Universe card costing (current turn) |

**Other**

| Anomaly | Effect |
|---|---|
| Audience Choice | At the start of each player's first turn, Discover an Entire-Universe card into each player's GY |
| Sliced Mangos | At the start of each player's first turn, Discover a Heroic Aura for their field |
| MEOW MEOW MEOW | All words become "meow" 😼. **Functionally identical; excludes keywords.** A pure text-layer filter |
| Dōngfāng Yóuxì Shèjì | Five-element system — below |
| ~~Jlore's Most Hated~~ | **Dropped this pass** — it operates on Card Slots ("play with only cards in no player's Premium Reservations or Flex Slots"), which don't exist without the meta layer. Restore with it. |

**Dōngfāng Yóuxì Shèjì (Five Elements)** — the most complex Anomaly:
- Every card is randomly assigned Water, Wood, Fire, Earth, or Metal.
- Each player's most recently played element is tracked.
- On play: if the new element **generates** the previous, the effect is **tripled**; if it's **destructive** to the previous, the effect is **negated**; otherwise normal.
- Generative: Wood → Fire → Earth → Metal → Water → Wood.
- Destructive: Wood → Earth, Earth → Water, Water → Fire, Fire → Metal, Metal → Wood.

This needs an effect-multiplier hook and an effect-cancel hook the whole effect system respects. **Build the multiplier hook early** — Solar Eclipse, KY's Chosen, Symphony of 3, Group Leader, Honest Living, and Misery all need it too.

---

## 9. Auras

Auras live in a **Field** zone and are not cards.

### 9.1 Heroic Auras

Granted by *Hero's Power*, *Hero's Recall*, and the Sliced Mangos anomaly. Cost **(2) Money to activate**, each usable **once per turn**. A player holds **only one**; a new one replaces the old.

| Heroic Aura | Effect |
|---|---|
| Learning Subscription | Add a Book to hand |
| Evolve | Trash a card from hand, add a random Known Universe card costing (3) more |
| Mycology | Discover two Known Universe cards costing (3) or less, Fuse them, add to hand |
| Power Play | Each opponent discards at random; if it was a Points card, add a Warhero Token to hand |
| Imprison | Lock a pile costing (5) or less; at the end of your next turn, unlock it and take a card from it |
| Cloning Gallery | Add a copy of your last-bought card to GY |
| Ladder to Heaven | Add a Truss to hand with +1 VP |
| Blessed by Raza | +1 Action, +1 Card. Refreshes whenever you play an Action |
| Smorc | Add a Tix to hand; the next Tix you buy this turn costs (0) |
| Dead Sea Scroll | +1 Prophet |
| Rugpull | +4 Money |

### 9.2 Celestial Auras

Persistent passives, from Anomalies, *Conjure Aura*, *Scripture of Space*, *Quest Accepted!*, *Edge of Tomorrow*, *Infini Scepter*, In Too Deep rewards, and *Jlarna*'s drawback.

| Aura | Effect | Source |
|---|---|---|
| Double Header | First buy each turn adds an extra copy to GY | Anomaly; In Too Deep 4c |
| The Invisible Hand | Shop cards cost (2) less for you, min 0 | Sasalele |
| Kwzki's Stimulants | +1 Action, +3 Cards per turn | Adrenaline |
| Symphony of 3 | Every third card played triggers twice | Rule of Thirds |
| March of Progress | Start of turn: a random Entire-Universe card costing (current turn) | Onward to Victory! |
| Outstanding Debt | −X Money for 4 turns, X = `ceil((20 − unspent Money)/4)` | Jlarna (drawback) |
| In Too Deep | Starts the multi-floor quest. One instance at a time | Quest Accepted! |
| Undead Army | Played cards go to the bottom of your Library; start of turn +3 Cards, +1 Action | In Too Deep 4a |
| Market Manipulation | Resource Money doubled; Resources cost (0) in the Resource Shop | In Too Deep 4b |
| Yuya's Mythical Portal | Start of turn: 2 Epics and 1 Legendary to hand, +3 Actions | In Too Deep 4d |
| Aspect of Ares | You may play no Action but War!; gain a War! each turn | Edge of Tomorrow |
| Oathbound Memory: [Card] | Start of each turn, a Temporary copy of the bound card to hand with +1 Action | Infini Scepter |

### 9.3 Hypercelestial Auras

| Aura | Effect | Source |
|---|---|---|
| Lotus Solutions | After your turn, an AI plays a **second turn** with your deck | Outsourcing R&D, 3rd play |
| Shooting Star | On summon, gain the effect of 3 random Celestial Auras | Wish Upon the Stars, 100th play |

`[OPEN]` can a player hold multiple Celestial Auras? Heroic is explicitly capped at one; the others are unstated. **[PROPOSED]** unlimited Celestial, one Heroic, one Hypercelestial.

---

## 10. Card data model and effect DSL

### 10.1 Three levels of card identity

Forced by Universal Buff!/Nerf! ("all copies wherever they are"), Quick Patch (one instance), Homebrew and Hivemind (permanently absorb effects), Relics (per-instance upgrades), and the Lection/Runebinder/Coal per-game play counters.

```
CardDefinition   — immutable shipped content. The printed card.
  ↓
CardVariant      — per-match overrides on a definition: Universal Buff/Nerf,
                   elemental assignment under Dōngfāng Yóuxì Shèjì, pile cost changes.
  ↓
CardInstance     — a specific physical card. Owns zone, position, owner,
                   flags (Flimsy/Temporary/Indestructible), counters (Plague, VP,
                   playCount), instance stat deltas, fusion components,
                   playedOnTurn, and a per-viewer visibility set.
```

Getting this wrong early is expensive. A single flat card object cannot express "Universal Buff! buffed every Truss in the game" and "Quick Patch buffed *this* Truss" at the same time, and both cards exist.

### 10.2 Schema sketch

```jsonc
{
  "id": "temple_marketplace",
  "name": "Temple Marketplace",
  "cost": { "money": 6 },          // signed; Prophet cards use { prophet: {threshold, drain} }
  "types": ["Action"],             // Action | Resource | Points | Token | Relic | Book | Food
  "subtypes": ["Truss", "Felinor", "CN", "Diamond", "Gold", "Egg", "Distilled", "Scripture"],
  "tags": ["Legacy", "PvP", "EndOfGame"],
  "rarity": "rare",
  "keywords": ["Flimsy"],
  "stats": { "actions": 1, "buys": 1, "cards": 1, "money": 1, "prophet": 1, "vp": 0 },
  "effects": [ /* ordered effect nodes */ ],
  "triggers": [ { "on": "discard", "effects": [] } ],
  "dynamicText": "…{playsRemaining} left!…",
  "flavor": "Who would crash out over this?",
  "complexity": "T2",
  "subsystems": ["S-PROPHET"]
}
```

**Why `stats` is separate from `effects`:** Buff/Nerf randomly picks a **base stat** and ±1s it. If "+1 Money" is buried inside a scripted effect blob, Buff cannot find it. Plain stat lines live in the structured `stats` object; only non-stat behaviour goes into `effects`. The same separation is what lets the MEOW anomaly rewrite words without touching keywords, and what makes localization possible at all.

### 10.3 Effect DSL

A tree of typed nodes rather than scripts:

```jsonc
{ "op": "gain",       "stat": "money", "amount": 3 }
{ "op": "gain",       "stat": "money", "amount": { "expr": "floor(uniqueCardsInDeck / 3)" } }
{ "op": "draw",       "amount": 4 }
{ "op": "discard",    "target": "self.hand", "amount": 4, "chooser": "self" }
{ "op": "trash",      "target": { "zone": "hand", "filter": { "type": "Resource" } } }
{ "op": "discover",   "pool": { "scope": "knownUniverse", "filter": { "cost": { "lte": 3 } } },
                      "count": 3, "then": [ { "op": "moveTo", "zone": "hand" } ] }
{ "op": "gainCard",   "source": "shop", "filter": { "cost": { "eq": 4 } }, "to": "hand" }
{ "op": "lockPile",   "chooser": "self", "duration": { "until": "startOfNextTurn" } }
{ "op": "delayed",    "when": "startOfNextTurn", "effects": [] }
{ "op": "conditional","if": { "expr": "combo >= 3" }, "then": [], "else": [] }
{ "op": "modifyCost", "scope": "draftShop", "delta": -1, "floor": 1, "duration": "turn" }
{ "op": "manifestAura","tier": "celestial", "auraId": "double_header" }
{ "op": "buff",       "scope": "allCopies" | "instance" | "pile", "amount": 1 }
{ "op": "random",     "weights": [ {"w":0.7,"effects":[]}, {"w":0.3,"effects":[]} ] }
```

**Expression language.** Needed variables: `deckSize`, `uniqueCardsInDeck`, `avgCostOfDeck`, `sdOfDeckCost`, `madOfOpponentDeck`, `sumOfDeckCosts`, `handSize`, `currentTurn`, `playerCount`, `buysRemaining`, `moneyUnspent`, `comboCount`, `cardsPlayedThisTurn`, `libraryHeight`, `countInDeck(filter)`, `plagueTokensOn(card)`, `emptyOrLockedPiles`.

Cards that need it: Courtyard of Squeam, Library of Gods, Whale Poaching, Tnack's Ingenuity, Fountain of Possibilities, Marble Columns, Stand Together, Diversity Hater, HR Trainee, Mercenary 280, Book of Lethal Kill, Treasure Vault, Monumental Works, Oh Mr. Lebon, The Biggest The Largest, Giant's Aid, A Duel of Wits, Biblical Greed, Constellation, Star Aligner, Jalshi, Juhan Wet Market.

### 10.4 Live card text

Many cards print their own state: "(5 left)", "(3 turns left!)", "(currently X)", "(Currently point to: ___)", "(Current pointing vector: X, Y, Z)", "Current effects: ___". Card text must be a **template rendered against instance state, per viewer** — hidden-info cards render one way for the owner and another for opponents.

**Pathological case:** *Hired Shrimp* — "Trash all cards in your opponents hand with less words than this card. (16 words)" — with the doc's own note that the count must change if words are appended. Its rules text is a function of its own rendered length. **[PROPOSED]** freeze the word count per localization at build time, expose it as a template variable, and forbid runtime text mutation on this card (Homebrew and Hivemind should refuse it). Do not build a general self-referential text system for one card.

---

## 11. Subsystem inventory

Sequenced by dependency. Every card in Appendix A maps to one or more of these.

| ID | Subsystem | Depended on by | Priority |
|---|---|---|---|
| **S-CORE** | Zones, turn loop, buy/play, shuffle, VP scoring | Everything | P0 |
| **S-DISCOVER** | Weighted pool sampler + choice UI over any filter | ~60 cards | P0 |
| **S-LOCK** | Pile locking with durations and unlock triggers | Chains of the Sovereign, Lockdown, Blackout, Go Fish, Back to Basics, Freeze Tag, Arm of the Jempire, Seal the Rift, Imprison, Gold Ship, Archwarden, Pocket Wormhole, Series Funding | P0 |
| **S-COSTMOD** | Layered, ordered, floored cost modifiers | The Jlore Must Flow, Cup Runneth Over, Throttle Markets, Price Fixing, Discount Coupon, Miracle Prep, Nickel and Dime, Dynamic Pricing, Fading Blossom, Invisible Hand, Accel Giant, Missed Vintage, Vexxed, Professor of Curvature, Lead, Pure of Heart, Blood Diamond, Giant's Aid | P0 |
| **S-DELAYED** | "next turn", "in N turns", "at the start of your Nth turn" queues | Careful/Reckless Investment, Preparation, Loan Shark, Biblical Greed, Moon Dance, Rosemary Triscuit, Chron Job, Pocket Pouch, The Divined Cosmos, Aggressive Taxation, 25th Hour, Energy Drink | P0 |
| **S-PROPHET** | Threshold currency, its shop, debt | 24 Prophet cards + ~15 generators | P0 |
| **S-TOKEN** | Non-purchasable generated cards | ~35 tokens | P0 |
| **S-CODEX** | Per-account seen-card set feeding Known Universe pools | ~30 cards | P1 |
| **S-PERSIST** | Per-instance counters surviving zone changes and shuffles | Lection, Runebinder, Coal, Discount Coupon, Journey to the Moon, Wish Upon the Stars, Outsourcing R&D, Relics, Tixatus, Oh Mr. Lebon, Skyscraper, BOOM! Big Max, Plague Charger, 25th Hour, Hivemind, Homebrew, Wombo Combo | P1 |
| **S-AURA** | Field zone, three aura tiers, activation economy | ~25 cards | P1 |
| **S-COMBO** | Per-turn played-card counter, reset, copyable clauses | Group Leader, Ricochet ×3, Experience Dividend, Around the World, Meditation, Crime Wave, Second-Degree Forgery, Petty Theft, Combo Meal, Soul Slicer, Wombo Combo, Relic of Totality, Dynamic Stat Allocation | P1 |
| **S-BIGACTION** | Multi-Action-cost plays | Vault, Safe, Silver Stash, Big Truss, Nap, Chonker, Slop Bowl, Moon Rock, Relic of Totality, Dynamic Stat Allocation, Too Many Stats | P1 |
| **S-BUFF** | Buff/Nerf/Upgrade at definition, pile and instance scope | Universal Buff!/Nerf!, Quick Patch, Indirect Buffalo, Performance Enhancing Cookie/Crumb, Relics, Evercrown, Homebrew, RCT CN, Bullseye, CN Century of Humiliation, Jmart Banana Bunch, Monumental Works, Shining Kit | P1 |
| **S-MULTIPLIER** | Effect doubling / tripling / negating hooks | Solar Eclipse, KY's Chosen, Symphony of 3, Group Leader, Misery, Drain Game, Honest Living, Dōngfāng Yóuxì Shèjì | P1 |
| **S-HIDDEN** | Per-player visibility of card identity and hidden values | Ascendant Spread (secret VP), The Trilogy preview, Ebon Hand preview, Call to Chaos "unknown card" entries | P1 |
| **S-TEXTGEN** | Live-templated card text per viewer | ~40 cards | P1 |
| **S-ANOMALY** | Match modifier roll, mutex groups, global rule patches | Game variance | P1 |
| **S-STEAL** | Cross-player zone reads and writes | Griftah, Thought Steal, Spyglass, Antics, Bribe, Corruption Scandal, Petty Theft, Corpo Espionage, Ambush Bid, The Curator, Midnight Raid, Loot Attack, IP Theft, Cult Leader | P2 |
| **S-PLAGUE** | Counters on card instances in *any* zone including shop piles | Crop Dusting, Plague Crawler, Plague Charger, Outbreak, Living Bomb, Plandemic, Patient Zero, Antibody Extraction, Spider E.B., CNcias, Jalshi, Juhan Wet Market, BOOM! Big Max | P2 |
| **S-QUEST** | In Too Deep branching floors with persistent progress | Quest Accepted! | P2 |
| **S-AI** | Bot that plays a turn from a given deck state | Outsourcing R&D, single-player, Battle Royale filler | P2 |
| **S-ENDGAME** | Deferred scoring separated from running VP | Constellation, Star Aligner | P2 |
| **S-FUSE** | Composite cards from 2+ parents | Matchmaker, Freaky Phil, What is Love?, Frankenstein, Heroic Aura Mycology | P3 |
| **S-AUCTION** | Cross-turn blind bidding with chips | Glubby Gloob the Auctioneer | P3 |
| **S-SIM** | "A reality where you win" solver | Infinite Realities, Second Time Around, Zephrys | P3 |

### 11.1 The three expensive ones

**S-FUSE.** Five cards produce fused cards, and *Chopped Chuzz* has an explicit anti-fusion clause ("when this attempts to Fuse, trash it instead") — meaning fusion is expected to be common enough to need counterplay. A fused card needs combined cost (`[OPEN]` sum or max?), unioned types and subtypes, summed base stats, concatenated effects in a defined order, a generated name and art treatment, and its own rarity (**[PROPOSED]** the max of its components). It must survive being copied, Discovered, and Buffed. Matchmaker and Freaky Phil fuse cards **already in your Library**, so fusion mutates existing instances in place. This is the single most expensive card behaviour in the game.

**S-SIM.** Three cards consult a reality where you win: *Infinite Realities* (20) replaces hand/Library/GY with a winning deck, *Second Time Around* (5) Discovers a card from one, and *Zephrys* (10) Discovers "the perfect card for your hand" — its own flavor text admitting "YOUR WISH IS MY SUGGESTION (bad programming)". **[PROPOSED]** don't build a solver. Use a heuristic scorer: evaluate candidates against the board with a hand-tuned utility function (money needed to reach the next buy threshold, actions available, VP gap, cards left in Library) and return the best. For Infinite Realities, generate a curated high-synergy deck from the player's Known Universe. The flavor survives; the compute doesn't happen.

**S-AI.** Needed earlier than you'd guess. *Outsourcing R&D* grants an aura where an AI plays a full extra turn with your deck, mid-match, in live multiplayer. It has to be deterministic (seeded) and sub-second so it doesn't eat the turn timer. Reuse it for single-player and for filling Battle Royale lobbies.

---

## 12. Architecture notes

### 12.1 Authority and determinism

- **Server-authoritative.** Hidden information is everywhere — Ascendant Spread's secret VP value, library contents, the Call to Chaos "unknown card" entries, blind auction bids. Never let the client hold what the player isn't entitled to.
- **Seeded RNG, one stream per match plus a sub-stream per player.** Randomness saturates this game (Highroller, A Fool's Prayer, Eggs, Grapevine, Predatory Monetization, Lead, Too Many Stats, every "random card from the Entire Universe"). Without seeds, replays and bug reports are worthless. Log `(seed, actionLog)` per match; the whole match should be reconstructible from it.
- **Full action log** for replays, spectating, disputes, and balance telemetry.

### 12.2 Effect resolution

Use a **resolution queue with nested prompts**, not a synchronous call stack:

1. Playing a card pushes its effect nodes onto the queue.
2. Nodes resolve FIFO.
3. A node needing a choice (Discover, "choose a pile", "choose one") suspends the queue and emits a prompt; it resumes on response, with a timeout default.
4. Triggers enqueue behind the current node.
5. **Depth cap and cycle detection are mandatory.** *The Past* copies the last card played, *The Future* copies the next, and *The Eternal Show* explicitly describes the loop between them. *Grape* plays a random Action in hand — which can be another Grape. *Misery* replays every Action you played this turn. *Book of Books* adds two Books. Set a hard cap (suggest 200 nodes per turn) and a fizzle rule.

### 12.3 Timing windows to build up front

`onGain` and `onBuy` are **different** — many cards add to GY without a purchase. `onDiscard` fires both at end-of-turn cleanup and from effects, and a lot of cards key off it specifically (CN Developer, Potato, Grapevine, Jakkari Sacrifice, Nether Portal, Sleep Preacher, Bullseye, Fist of Jraxxus, Juhan Wet Market, BOOM! Big Max). `onTrash` matters for Garlic, Cookie Gruzzler, Chonker, Took Him to the J'O, Recurring Felinor, Astrologist, Tilted Towers, Paper Sculpture, Chopped Chuzz, Mewing. Also needed: `onDraw`, `onShuffle`, `onLock`/`onUnlock`, `onBuff`, `onPileEmpty`, start/end of turn.

### 12.4 Client

- Turn timer as a first-class concept (Time Flail multiplies it by 2.5).
- Card text is template + state, rendered per viewer.
- The MEOW anomaly is a text-layer filter that must not touch keyword tokens — a useful forcing function for keeping rules text structured rather than authored as strings.
- Live counters everywhere: "3 turns left!", "25 times left", "(currently X)".
- Fusion needs a generated-card visual treatment.

### 12.5 Telemetry

Randomized Anomalies plus permanent Buff/Nerf mean this game can't be balanced by inspection. Instrument from the first playable build: win rate by card and by Anomaly, buy rate and first-buy turn per card, match length by variant, which end condition fired, and Discover pick rates (a card offered constantly and never picked is a dead card).

---

## 13. Build order

| Phase | Scope | Done when |
|---|---|---|
| **P0 — Playable core** | S-CORE, S-DISCOVER, S-LOCK, S-COSTMOD, S-DELAYED, S-PROPHET, S-TOKEN. Fixed 10-pile Draft Shop, Standard win condition, no Anomalies. ~120 T1/T2 cards. | Two humans finish a game that feels like Dominion plus the Prophet track. |
| **P1 — Systems** | S-CODEX, S-PERSIST, S-AURA, S-COMBO, S-BIGACTION, S-BUFF, S-MULTIPLIER, S-HIDDEN, S-TEXTGEN, S-ANOMALY. ~280 cards. | Anomalies roll, auras function, rarity gates pools, cards remember their own history. |
| **P2 — Depth** | S-STEAL, S-PLAGUE, S-QUEST, S-AI, S-ENDGAME. All win-condition variants, Battle Royale. Everything except the T4 set. | Full archetype coverage: Plague, Felinor, Food, Soul Shard, Goblin, Truss, CN, Book, Relic, Egg, Warhero. |
| **P3 — The hard ones** | S-FUSE, S-AUCTION, S-SIM. Mythic tier. Arc of the Universe, The Eternal Show, Counting Cards, A Duel of Wits, Too Many Stats. | Full catalog live. |

**Recommended vertical slice:** the **Felinor** archetype. ~15 cards spanning tokens, trash triggers, cross-player card gifting, and a Points payoff, needing only P0 systems plus `onTrash`. It'll surface most core-engine bugs cheaply.

---

## 14. Open questions

**Blocking**

1. **`Big Action X` is never defined.** 11 cards use it. Proposed: costs X Actions to play.
2. **`Recruit` is never defined**, and is used as both a verb and a numeric stat. Proposed: search-a-zone-to-hand, then shuffle.
3. **End condition conflict** — "4 shop piles" vs "40% of Draft Shop piles".
4. **Pile sizes are never specified** for any pile. Proposed: by rarity.
5. **Does a Prophet purchase consume a Buy?** Proposed: no.
6. **Duplicate card name: `Blood Diamond`.** Two different cards — (10) Action/Diamond with a cost-reduction clause, and (5) Resource/Diamond with −5 VP. Rename one.
7. **`Mutilate`** appears only inside Pointer's definition and is defined nowhere.
8. **`Unfathomable`** appears only on Prophesized Jlore and is defined nowhere.
9. **Variant parameters `X`** unspecified for Countdown, Duel, and Crown.
10. **Draft Shop size and source** now that slots are out of scope — 10 piles is a placeholder, not a decision.

**Design-level**

11. Can multiple Anomalies roll at once? Several are mutually exclusive.
12. Can a player hold multiple Celestial Auras? Heroic is capped at one; the rest are unstated.
13. Fusion arithmetic: how do cost, rarity, types, and conflicting effects combine?
14. Is the whole Prophet Shop present every match, or sampled?
15. Tiebreaker when VP is level at game end.
16. `Indestructible` + `Flimsy` interaction.
17. Does Buff/Nerf on a card with a 0 in that stat *add* the stat line, or only modify existing ones? (Determines whether Universal Buff! can give a Resource +Actions.)
18. Known Universe scales with play history, so a new player's Discovers are strictly worse than a veteran's at the same table. Decide whether that's progression or a trap (see §6).

**Card-specific gaps**

19. *Scripture of Siva* — body is "[to add]". Unfinished.
20. *Call to Chaos* — 30+ unweighted effects, several near-game-ending. Needs weights (draft in Appendix B.2).
21. *Counting Cards* — "play 21-jack with the top of your Library" needs a full blackjack sub-spec (soft/hard aces, no dealer stated).
22. *A Duel of Wits* — asks the player to compare two randomized logarithms of deck statistics. Playable in principle, hostile in practice. Needs a UI decision and a time limit.
23. *Arc of the Universe* — a real 3-D gravitational alignment sim paying +999 VP at ≤1°. Needs its own mini-spec, a persistent visualization, and a hard answer on whether +999 VP is meant to be a genuine win button.
24. *The Past* / *The Future* / *The Eternal Show* — a deliberate paradox loop. Needs an explicit resolution rule.
25. *Too Many Stats* — cost and all stats reroll every turn. Confirm the cost range `(2,10]` and what happens to a card in hand when its cost shifts mid-turn.
26. *Craft a Card* — three cards share a name, differing only by price, and the price is "the highest it can be while still being purchasable" — i.e. a function of the buyer's current Money. Confirm.
27. *Lead* — cost rerolls between (−2) and (10) and pays out its own cost. At (−2) with enough Buys it's an infinite money engine. Confirm the floor.
28. *Prophesized Jlore* (+100 VP) versus *Aim for the Moon* (game ends at 20 VP) — one card instantly ends that variant.
29. *Mercenary 280* — "+280 VP iff the sum of your deck's costs is exactly 280." Confirm it's a joke and not a Crown/Duel problem.
30. Content typos to fix: "Flismy" ×4 (the Egg cartons), "acquistioning", "Chicken Coup" (Coop), "Fuit Gummy".

---

## Appendix A — full card catalog

**Legend.**
`T` = implementation complexity tier: **T1** pure stat line · **T2** simple deterministic scripted effect · **T3** interactive / random / hidden-info / cross-player · **T4** requires a dedicated subsystem.
Rarity per the model in §7. `Basic` and `Token` are non-collectible.
Effect text is condensed — the design doc remains authoritative for exact wording.

### A.1 Resource Shop (Basic, always present)

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Copper | 0 | Resource, Copper | Basic | +1 Money | T1 |
| Silver | 3 | Resource, Silver | Basic | +2 Money | T1 |
| Gold | 6 | Resource, Gold | Basic | +3 Money | T1 |
| Diamond | 10 | Resource, Diamond | Basic | +5 Money | T1 |

### A.2 Points Shop (Basic, always present)

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Tix | 2 | Points, Tix | Basic | +1 VP | T1 |
| Robux | 5 | Points, Robux | Basic | +2 VP | T1 |
| Jlore | 8 | Points, Jlore | Basic | +3 VP. **Emptying this pile ends the game.** | T1 |

### A.3 Prophet Shop

Notation: `(drain) — Prophet threshold`.

| Card | Drain | Threshold | Types | Rarity | Effect | T | Notes |
|---|---|---|---|---|---|---|---|
| Chains of the Sovereign | −1 | 1 | Action | Rare | Play on Buy, Flimsy. Lock a Draft Shop pile; unlock costs an opponent (−2) Prophet. Fails if ≥50% of piles already Locked | T3 | S-LOCK |
| Destiny Draw | −1 | 1 | Action | Rare | Draw the most expensive card in your Library. +1 Action | T2 | |
| Mulligan | −1 | 2 | Action | Common | Play on Buy, Flimsy. Discard hand, +5 Cards | T2 | |
| Cost Co. | −2 | 2 | Action | Epic | +2 Actions, +2 Buys, +2 Cards, +2 Money | T1 | |
| All In | −3 | 3 | Action | Epic | Play on Buy, Flimsy. Recruit your deck, then trash it | T3 | Recruit def needed |
| Platinum | −1 | 3 | Resource | Rare | +4 Money | T1 | |
| The Trilogy | −2 | 3 | Action | Epic | Cast on Buy, Flimsy. Add the 3 Books printed on this to hand (previewable on hover) | T3 | S-HIDDEN preview |
| Pray for Rain | −1 | 3 | Action | Rare | Cast on Buy, Flimsy. Add 5 random Resources to GY | T2 | |
| Project: Doomsday | −3 | 3 | Action, PvP | Legendary | Cast on Buy. Doomsday Counter +1; at 10 the game ends immediately. Add a Doomsday Button to a random opponent's GY | T3 | Global counter |
| Kwzki High Council Consultant | −2 | 4 | Action | Epic | Play on Buy. On play or discard, add a Temporary (−1) Prophet card from the Known Universe to hand | T3 | |
| Truss Pluss | −1 | 4 | Action, Truss | Rare | +4 Actions, +2 Cards | T1 | |
| Seal the Rift | −2 | 4 | Action | Rare | Lock a Draft Shop pile; next turn unlock it and add its top card to your GY. +1 Action | T3 | S-LOCK |
| Ebon Blade | −3 | 5 | Action | Legendary | Trash the most expensive card in each opponent's deck. +1 Action | T3 | S-STEAL |
| Idol of the False God | −3 | 6 | Action | Legendary | Cast on Buy, Flimsy. Replace your hand with random Legendaries. Lock the Prophet Shop until end of turn | T3 | Rarity pool |
| Religious Dividends | 0 | 7 | Action | Rare | Play on Buy, Flimsy. On buy, Lock this pile until next turn. +2 Money, +1 Card | T2 | |
| Giant's Horn | −4 | 8 | Action | Epic | Flimsy, Play on Buy. +1 Action. Discover an Action costing (10)+ from the Entire Universe to hand | T3 | |
| Scripture of Kwzki | −5 | 10 | Action, Scripture | Legendary | Play on Buy, Flimsy. Choose a Draft Shop pile: this turn its cards cost (3) less and gain Play on Buy | T3 | S-COSTMOD |
| Scripture of Siva | −5 | 10 | Action, Scripture | Legendary | **UNFINISHED — "[to add]"** | — | See §15 |
| Scripture of Jayaad | −5 | 10 | Action, Scripture | Legendary | Play on Buy, Flimsy. Trash all Libraries | T3 | Extremely swingy |
| Scripture of Space | −5 | 10 | Action, Scripture | Legendary | Play on Buy, Flimsy. Discover a Celestial Aura to manifest | T3 | S-AURA |
| Tnack Trav, Prophesized Savior | 0 | 16 | Action, Warhero Token | Legendary | Play on Buy, Flimsy. Add a Warhero Token to GY. +1 Buy | T2 | |
| Prophesized Jlore | −30 | 30 | Points | **Mythic** | +100 VP. Unfathomable. If obtained by any other means, TRASH THIS | T3 | The Prophet win condition |
| The Unconcerned Lion | −1 | 0 | Action, Felinor | Rare | You may go into Prophet debt to buy this. +3 Cards | T2 | Only debt-legal card |
| Doomsday Button | 0 | Action, Token | Token | Flimsy. Doomsday Counter +1; at 10 the game ends immediately | T2 | Generated only |

### A.4 Draft Shop — Prophet generation

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Novice Acolyte | 2 | Action, Legacy | Common | Flimsy. +1 Prophet | T1 |
| Prophet Injection | 3 | Action | Common | Play on Buy, Flimsy. +1 Prophet | T1 |
| Perish Priest | 4 | Action | Common | +1 Prophet | T1 |
| Lection | 4 | Action | Epic | Flimsy. +1 Prophet. On the 5th play, +1 Action and add a random Scripture to hand (live counter) | T4 (S-PERSIST) |
| Pomegranate | 4 | Action, Food | Rare | Flimsy. +2 Prophet | T1 |
| Mythmaker | 6 | Action | Rare | +2 Prophet | T1 |
| New Canon | 3 | Action | Rare | Trash all Prophet, Book and Relic cards in hand. +1 Prophet and +1 Card for each | T2 |
| Meditation | 4 | Action | Rare | +2 Prophet. Combo 1: +2 Cards instead | T3 (S-COMBO) |
| Sleep Preacher | 5 | Action | Rare | On play **or discard**, +1 Prophet | T2 |
| Money Church | 7 | Action | Rare | Spend all Money. +X Prophet (max 5), X = Money lost | T2 |
| Temple Marketplace | 6 | Action | Rare | +1 Action, +1 Buy, +1 Card, +1 Money, +1 Prophet | T1 |
| Feel so Clean Like a Prophet Machine | 4 | Action | Epic | Discard adjacent cards; +1 Action per (1)-cost discarded; if hand empty, +2 Prophet | T3 (hand adjacency) |

### A.5 Draft Shop — core economy and money

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Feather | 0 | Action | Common | Flimsy. +1 Action, +1 Buy, +1 Card, +1 Money | T1 |
| Loose Change | 0 | Action | Common | +1 Money. If exactly 1 card played before this, +1 Money | T2 |
| Jay Fungus | 1 | Action | Common | Shuffle an extra copy of this into your GY. +2 Money | T2 |
| Careful Investment | 1 | Action | Common | +2 Money next turn | T2 (S-DELAYED) |
| Reckless Investment | 1 | Action | Common | +3 Money, −2 Money next turn | T2 (S-DELAYED) |
| Preparation | 1 | Action | Common | +3 Cards next turn | T2 (S-DELAYED) |
| 2.6 Kwzki Cycle | 1 | Action | Common | +1 Action, +1 Buy, +1 Card | T1 |
| Energize | 1 | Action | Common | +2 Actions | T1 |
| Market | 3 | Action | Common | +1 Buy, +1 Card, +1 Money | T1 |
| Marketplace | 5 | Action | Common | +1 Action, +1 Buy, +1 Card, +1 Money | T1 |
| Loan Shark | 3 | Action | Rare | +5 Money, −10 Money next turn | T2 |
| La Economia | 4 | Action | Common | +2 Actions, +2 Money | T1 |
| Smart Savings | 3 | Action | Rare | Unspent Money carries to next turn. +1 Action, +1 Money | T2 |
| Big Spenda | 5 | Action | Common | +2 Buys, +2 Cards, +2 Money | T1 |
| Giga Buy | 5 | Action | Rare | +4 Buys, +2 Money | T1 |
| 9-5-5 | 5 | Action | Common | +3 Actions | T1 |
| 9-9-6 | 7 | Action | Rare | +4 Actions | T1 |
| Ultimate Infestation | 10 | Action | Epic | +5 Actions, +5 Buys, +5 Cards, +5 Money | T1 |
| AA's Bargain | 3 | Action, Points | Rare | +1 Action, +1 Card, +3 Money, −2 VP | T1 |
| You're all fired | 5 | Action | Rare | Trash your hand and this card. +2 Buys, +10 Money | T2 |
| Day Trader | 2 | Action | Rare | +2 Money, repeated for each Silver in your GY | T2 |
| Senior Associate | 2 | Action | Rare | Discard a Tix for +2 Money, else add a Tix to hand. +1 Buy | T2 |
| Goldman VP | 5 | Action | Rare | Discard a Robux for +5 Money, else add a Robux to hand. +2 Buys | T2 |
| Honest Living | 4 | Action | Epic | If you played only Resources before this, double your Money | T3 (S-MULTIPLIER) |
| Pure of Heart | 4 | Action | Rare | Costs (0) if your hand is empty. +2 Actions, +2 Cards | T2 (S-COSTMOD) |
| Overpaid Intern | 2 | Action | Common | +1 Action, +1 Card. If 3+ Buys: +1 Buy, +1 Money | T2 |
| Venture Backed | 6 | Action | Rare | +2 Cards, +2 Money. If you gained 3+ cards this turn (incl. tokens), +1 Action, +1 Buy | T2 |
| ISDA Agreement | 2 | Action | Rare | Flimsy. +5 Buys | T1 |
| Express Shipping | 3 | Action | Rare | +1 Action, +1 Money. The next card you buy this turn goes to hand | T2 |
| Energy Drink | 3 | Action | Common | +3 Actions, +2 Cards, −1 Action next turn | T2 |
| A Fool's Prayer | 0 | Action | Rare | 10% chance of +20 Money | T2 |
| Highroller Type A | 3 | Action | Rare | Randomly +4 of Actions, Buys, Cards or Money | T2 |
| Highroller Type B | 3 | Action | Rare | Coin flip: +3 Money, or +2 Cards | T2 |
| Highroller Type C | 3 | Action | Rare | Roll a die: +(roll − 1) Money | T2 |
| Highroller Type X | 3 | Action | Epic | Coin flip: +8 Money, or trash 4 random cards from deck then trash this | T2 |
| The Biggest, The Largest | 1 | Action | Epic | If you have the largest deck, +X Money (X = size lead). Then trash your GY. +1 Card | T3 |
| Diversity Hater | 5 | Action | Rare | +X Money, X = uniqueCardsInDeck − 8 | T2 |
| HR Trainee | 3 | Action | Rare | +X Money, X = floor(uniqueCardsInDeck / 3). Cycle if X ≥ 3 | T2 |
| Rebate | 3 | Action | Rare | +1 Buy. First purchase this turn refunds 60% of its cost (round up) | T3 |
| Biblical Greed | 5 | Action | Epic | Flimsy. Lose all Money. In 5 turns: +X Money and +3 Buys, X = lostMoney×4 + 5 | T3 (S-DELAYED) |
| Professor of Curvature | 1 | Action | Epic | On turn X, the next (X)-cost card you buy is free | T3 (S-COSTMOD) |
| Lead | −2…10 | Action | Epic | Cost rerolls between (−2) and (10) each turn. +[buy price] Money | T4 (S-COSTMOD) |
| Accel Giant | 11 | Action | Epic | On buy, all other cards in this pile cost (2) less. +2 Actions, +2 Buys, +2 Cards | T3 (S-COSTMOD) |
| Giant's Aid | 11 | Action | Epic | Costs (1) less per card played this turn. +2 Actions, +2 Buys, +2 Cards | T3 (S-COSTMOD) |
| Jlarna | 8 | Action | **Legendary** | Flimsy. +20 Money, +5 Buys, +1 Action. End of turn gain Celestial Aura *Outstanding Debt* (−X Money for 4 turns) | T4 (S-AURA) |
| Series A Funding | −1 | Points | Rare | On buy, Lock this pile until next turn | T2 |
| Series B Funding | −2 | Points | Rare | On buy Lock pile. −1 VP | T2 |
| Series C Funding | −3 | Points | Rare | On buy Lock pile. −3 VP | T2 |
| Series D Funding | −4 | Points | Rare | On buy Lock pile. −5 VP | T2 |
| Series E Funding | −5 | Points | Epic | Indestructible. On buy Lock pile. −8 VP | T2 |
| Series F Funding | −6 | Points | Epic | Indestructible. On buy Lock pile. −12 VP | T2 |
| Series X Funding | −7 | Points | Epic | Indestructible. On buy Lock pile. −18 VP | T2 |

### A.6 Draft Shop — Resource manipulation and refining

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Fool's Gold | 0 | Resource, Gold | Rare | Flimsy. +3 Money | T1 |
| Gleamstone | 8 | Resource, Diamond | Epic | +4 Money, +1 Buy | T1 |
| Blood Diamond *(resource)* | 5 | Resource, Diamond | Epic | +5 Money, −5 VP | T1 |
| Blood Diamond *(action)* | 10 | Action, Diamond | Epic | Trash Actions costing (1) or less from hand to reduce cost by (2) each. +1 Action, +5 Money | T3 |
| Magnet | 1 | Action | Common | Add up to 3 Copper from the shop to hand. +1 Action | T2 |
| Simple Refining | 2 | Action | Common | Trash a Copper in hand, add a Silver to hand | T2 |
| Advanced Refining | 5 | Action | Rare | Trash a Resource in hand, add its upgrade to hand | T2 |
| Pennymelting | 1 | Action | Rare | Trash a Resource in hand, add 2 copies of its **downgrade** to hand. +1 Action | T2 |
| Currency Cremator | 3 | Action | Common | Trash a Resource card for +3 Money | T2 |
| Goldoron | 4 | Action | Common | Flimsy. Add a Gold to GY | T1 |
| Diamondozen | 8 | Action | Rare | Flimsy. Add a Diamond to hand | T1 |
| Shine Bright | 4 | Action | Epic | Trash all Gold in hand → Diamonds; repeat for GY. +1 Action | T2 |
| Put a Ring on It | 7 | Action | Epic | Trash Silver→Tix, Gold→Robux, Diamond→Jlore (hand → GY) | T2 |
| Shining Kit | 4 | Action | Rare | The next Resource you play permanently gains +1 Money. +2 Money | T3 (S-BUFF) |
| Midas Touch | 6 | Action | Rare | Play on Draw. Transform a random card in hand into Gold | T2 |
| Depot Draw | 5 | Action | Rare | Reveal top 4 of Library; Resources to hand, rest discarded. +1 Action | T2 |
| Sticky Fungers | 2 | Action | Common | Move all Resources in your Library to the top. +1 Card | T2 |
| Villa D. Moneybags | 6 | Action | Legendary | Add a Gold to hand and a Gold to each opponent's GY | T3 |
| Intellectual Property Theft | 4 | Action | Rare | Discover a Resource in an opponent's GY, add a copy to hand | T3 (S-STEAL) |
| Second-Degree Forgery | 4 | Action | Rare | Flimsy. Copy the last Resource an opponent played to hand. Combo 3: loses Flimsy | T3 |
| Petty Theft | 4 | Action | Rare | Flimsy. Steal a Resource from an opponent's hand, else add a Silver to GY. Combo 3: loses Flimsy | T3 |
| Gold Ship | 4 | Action, Gold | Rare | +3 Money, +1 Action. Lock all piles but one until end of turn | T3 (S-LOCK) |

### A.7 Draft Shop — draw and hand sculpting

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Rapid Draw | 0 | Action | Common | Draw 4, discard 4 | T2 |
| Balanced Rapid Draw | 3 | Action, Legacy | Common | Draw 4, discard 4. +1 Action | T2 |
| Overclocked Rapid Draw | 3 | Action | Rare | Draw 8, discard 8 | T2 |
| Prime Rapid Draw | 5 | Action | Rare | Draw 5, discard 4. +1 Action | T2 |
| Card Destruction | 2 | Action | Common | Discard up to X, draw X. +1 Action | T2 |
| Profe Yates | 4 | Action | Common | +3 Cards | T1 |
| Sack of Cards | 6 | Action | Common | +1 Action, +4 Cards | T1 |
| Keyhole | 2 | Action | Common | Look at top 3: one to hand, one discarded, one back on top. +1 Action | T2 |
| Harbinger | 2 | Action | Common | Put a card from GY on top of Library. +1 Action | T2 |
| Star Compass | 2 | Action | Rare | +2 Cards. If they share a name, repeat | T2 |
| Snowball | 1 | Action | Rare | +1 Card, repeated up to 3 more times per consecutive (1)-cost played before this | T3 |
| Small Time Racketeer | 1 | Action | Rare | +1 Card, repeat until you draw a card costing (2)+ | T2 |
| Big Time Racketeer | 3 | Action | Rare | +1 Card, repeat until you draw a card costing (2) or less | T2 |
| Essential Oils | 2 | Action | Rare | Draw until you have drawn (4) of combined cost | T2 |
| One More Track | 3 | Action | Common | +1 Card; if this was the last card in hand, +5 Cards instead | T2 |
| Around the World | 2 | Action | Rare | Combo 5: +5 Cards | T3 (S-COMBO) |
| Power of 4 | 4 | Action | Common | Discard 4 cards. +4 Actions | T1 |
| False Dichotomy | 1 | Action | Common | Discard down to 2 cards. +2 Actions | T2 |
| Buffer Overflow | 5 | Action | Rare | +4 Cards then discard 2 at random. +1 Money per Resource discarded | T2 |
| Quantum Cut | 4 | Action | Rare | Reveal top 2: same cost → +3 Cards, else +2 Money. +1 Action | T2 |
| Fast Life | 4 | Action | Common | Mill 6. +2 Money | T2 |
| Pocket Pouch | 2 | Action | Rare | Discard a card; it returns to hand at start of next turn. +1 Action, +1 Card | T2 |
| Stowaway | 2 | Action | Rare | A random card in hand becomes Temporary. +3 Cards, +1 Action | T2 |
| Sleepy Joe Bider | 2 | Action | Rare | +2 Cards. End your turn immediately without discarding | T3 |
| Tanyay's Unstable Element | 6 | Action | Legendary | Flimsy. Draw your entire Library. You can't draw more this turn | T3 |
| Milkshake | 4 | Action, Food, Token | Rare | Flimsy. +4 Cards, +1 Action. Draw 2 fewer at end of turn | T2 |
| Merge Sort | 2 | Action | Epic | Shuffle GY into deck, then **sort the deck by ascending cost** | T3 |
| Save for Later | 2 | Action | Epic | +1 Buy, +1 Money. Copy your hand into a *Permanent: Hand Box*, shuffle it in, trash your hand | T4 |
| Repackage | 3 | Action | Epic | +1 Action. Copy your hand into a *Temporary: Hand Box* and shuffle it in | T4 |
| Echo Forge | 5 | Action | Rare | Put a Temporary copy of an Action you played this turn on top of Library | T3 |
| Sketch Artist | 4 | Action | Rare | Draw an Action from Library that grants no +Actions; add a Temporary copy to hand | T3 |
| Shadiris Visions | 3 | Action | Rare | Discover a card in your deck, add a **Temporary** copy to hand. +1 Action | T3 |
| Shadiris Manifestation | 4 | Action | Rare | Discover a card in your deck, add a copy to hand. +1 Action | T3 |
| Duplication | 3 | Action | Common | Add copies of two random cards in hand to hand | T2 |
| Model Citizen | 3 | Action | Rare | Discover 3 cards from your deck; the two unpicked transform into the picked one | T3 |
| Training Regiment | 3 | Action | Rare | The next Action you play this turn gains Play on Draw. +1 Action | T3 |
| The Divined Cosmos | 6 | Action | Epic | Place any number of cards from hand in an order; they activate in that order next turn | T3 (S-DELAYED) |
| Counting Cards | 9 | Action | Epic | Play 21 against the top of your Library; stand → play them all, bust → discard. (1) costs are aces | T4 |
| Map to the Golden Monkey | 8 | Action | Epic | Flimsy. Duplicate your hand | T2 |
| One With Nothing | 2 | Action | Common | Trash any number of cards in hand. +1 Action | T2 |
| Controlled Burn | 3 | Action | Common | Trash your GY. +2 Cards, +1 Action | T2 |

### A.8 Draft Shop — trashing, upcycling and deck sculpting

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Pawn Shop | 2 | Action | Common | Trash a non-Copper from hand: +2 Money, +1 Card. If Flimsy, also +1 Action | T2 |
| Daylight Salesman | 4 | Action | Common | Trash a card for +3 Money | T2 |
| Moonlight Salesman | 4 | Action | Common | Trash a card for +3 Cards | T2 |
| Upcycle | 4 | Action | Rare | Trash a card in hand to buy a card costing up to (2) more | T3 |
| Upcycled Upcycle | 5 | Action | Rare | Trash a card in hand to buy a card costing up to (3) more | T3 |
| Trash for Treasure | 3 | Action | Rare | Trash a card in hand; Discover a Draft Shop card costing (3) or less to hand | T3 |
| Recession Indicator | 3 | Action | Epic | Trash all (0)-cost cards in hand; optionally all non-Copper (0)-cost in opponents' hands. +1 Card | T3 |
| Pauper No Longer | 4 | Action | Rare | Trash all **Commons** in hand. +1 Card and +1 Money each | T3 (rarity query) |
| Scorched Earth | 5 | Action | Epic | Trash all other cards in hand. +3 Actions, +2 Buys, +4 Cards, +5 Money | T2 |
| Restart Mission | 7 | Action | Epic | Flimsy. Trash your deck; add 7 shop cards costing (7) or less to it | T3 |
| The Ultimate Sacrifice | 8 | Action | Epic | Trash two identical non-Resources in hand, then all remaining copies in deck; add that many Jlore to GY | T3 |
| Glitch in the System | 6 | Action | Epic | Trash all (0)–(3) cost cards in all decks (excluding Copper) | T3 |
| Twisting Nether | 9 | Action | **Legendary** | Flimsy. Choose a shop pile other than Jlore; trash it entirely | T3 |
| Safety Net | 2 | Action | Rare | The next non-Temporary card of yours trashed this turn goes to GY instead; if so, +1 Card. +1 Action | T3 |
| The Fall Guy | 1 | Action | Epic | Whenever one of your cards would be trashed by a non-Flimsy effect, this leaps from your deck to take the fall. +1 Card | T3 |
| Card Sleeve | 3 | Action | Epic | Flimsy. +1 Action, +1 Card. Remove Flimsy and Temporary from all cards in your deck | T3 |
| Cookie Gruzzler | 3 | Action | Rare | Trash the top card of each player's Library; when this is trashed, add them all to your GY | T3 |
| Corrosion | 3 | Action | Rare | +1 Action, +1 Card. Give 3 cards in opponents' decks Flimsy | T3 |
| Zzlurper | 1 | Action | Rare | Trash a card in the Shop. +1 Action | T2 |
| Coal | 0 | Action | Rare | −1 Money. On the 3rd play, trash this and add a Diamond to hand (live counter) | T4 (S-PERSIST) |

### A.9 Draft Shop — shop manipulation

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Window Shopping | 3 | Action | Common | Add a shop card costing (2) or less. +1 Buy | T2 |
| Spotter | 3 | Action | Common | Add a (4)-cost card from the Shop to hand | T2 |
| Elite Spotter | 7 | Action | Rare | Add an (8)-cost card from the Shop to hand | T2 |
| Blubber Baron | 4 | Action | Common | Add up to 2 shop cards costing (2) or less to GY | T2 |
| Shadow Moves | 5 | Action | Rare | Steal a random card from the Shop to hand. +1 Action | T2 |
| Firesale | 3 | Action | Rare | Steal a random (2)-or-less shop card to hand; if it's an Action, play it | T3 |
| Cult Leader | 6 | Action | Epic | Add a Draft Shop card you can currently afford; if it emptied the pile, steal all copies from opponents | T3 |
| Cult Recruiter | 4 | Action | Rare | You may buy from only one pile this turn. +2 Buys, +2 Money | T3 |
| Glorious Propaganda | 7 | Action | Rare | Add 1 random card from each of the Draft, Resource and Points shops | T2 |
| Mediator | 3 | Action | Rare | Discover a shop card; add it to **every** player's hand. +1 Action | T3 |
| Welfare | 5 | Action | Rare | Choose a shop card, add it to all players' GYs in turn order starting with you. +1 Action | T3 |
| Lockdown | 1 | Action | Common | Lock a Draft Shop pile until end of your next turn. +1 Card | T2 (S-LOCK) |
| Blackout | 4 | Action | Rare | Lock a Draft pile until end of your next turn. +1 Action, +1 Card | T2 |
| Back to Basics | 3 | Action | Rare | Flimsy. Lock all piles costing (6)+ until end of your next turn. +1 Action | T3 |
| Go Fish | 2 | Action | Rare | Choose an unlocked non-Copper pile; opponents discard all cards from it in hand; Lock it | T3 |
| Freeze Tag | 5 | Action | Rare | Lock one Draft pile, unlock a random other; if same cost, add the unlocked pile's top card to GY. +1 Action | T3 |
| Arm of the Jempire | 2 | Action | Rare | Lock 3 random piles until next turn; +1 Card for each you could have afforded. +1 Action | T3 |
| Archwarden of Jlore | 4 | Action | Epic | Flimsy. Lock the Jlore pile until (8) worth of cards are discarded. +1 Action, +1 Card | T3 |
| Cloud Nine | 2 | Action | Rare | Remove all cost changes and Locks from the Shop. +1 Action, +1 Buy, +1 Card | T2 |
| The Jlore Must Flow | 1 | Action | Rare | All shop cards cost (1) less this turn (min 1). +1 Buy | T2 (S-COSTMOD) |
| Cup Runneth Over | 3 | Action | Rare | Flimsy. Fully replenish a Draft pile; its cards now cost (1) less (min 1) | T3 |
| Throttle Markets | 5 | Action | Rare | Until your next turn: Draft piles cost (1) more, **or** Resource+Points piles cost (1) more. +1 Buy, +1 Money | T3 |
| Price Fixing | 4 | Action | Rare | Set a Draft pile's cost to the average Draft pile cost (round down) until end of next turn. +1 Action | T3 |
| Missed Vintage | 2 | Action | Rare | Reduce the top card cost of the two tallest Draft piles by (2). +1 Buy | T3 |
| Vexxed | 2 | Action | Rare | Swap the costs of two random piles | T2 |
| Discount Coupon | 2 | Action | Epic | Next card bought this turn costs (1) less; after 5 plays it becomes (0) instead (live counter) | T4 (S-PERSIST) |
| Miracle Prep | 0 | Action | Common | The next card you buy costs (2) less | T2 |
| Nickel and Dime | 3 | Action | Rare | Flimsy. The next card your opponent buys costs (1) more; when they buy, you gain a Silver | T3 |
| Pocket Wormhole | 3 | Action | Epic | Choose a Draft pile; Discover a Known Universe card to replace **all** copies in it. Lock it until next turn | T3 |
| Chron Caché | 4 | Action | Rare | Replace the 2nd card of a random pile with a (0)-cost Diamond. +1 Action | T2 |
| Supernova | 7 | Action | Epic | Add 10 random Entire-Universe cards to the tops of shop piles (Lunar Fragments possible). They all cost (1). +1 Buy | T3 |
| I Ship It | 3 | Action | Epic | Flimsy. Shuffle two piles together and split them evenly between the slots. +1 Buy | T3 |
| The Big Backening | 3 | Action | Rare | Add 2 copies of the first card you buy this turn to the top of that pile. +1 Buy, +1 Money | T3 |
| New Banner Day! | 1 | Action | Rare | Discover a card from a non-empty pile; if you later buy a different card costing ≥ it this turn, gain from that pile. +1 Money | T3 |
| Shopkeep | 4 | Action | Rare | Discard a card for each empty or Locked pile. +1 Action, +1 Buy, +1 Card, +1 Money | T2 |
| Five Year Plan | 2 | Action, CN | Rare | Replace a random Draft pile with a CN one. +1 Action | T3 |
| Bad Omen | 1 | Action | Rare | Flimsy. Choose a pile: buying from it now also gives a Cursed Pig | T3 |
| Water Into Swine | 5 | Action | Rare | Add a Cursed Pig to the top of every non-empty Draft pile | T2 |
| Glubby Gloob the Auctioneer | 3 | Action | **Legendary** | Flimsy. Blind auction for 3 random shop cards. You get 6 chips, opponents 5; resolves at the start of your next turn | T4 (S-AUCTION) |
| Jlore Accelerator | 2 | Action | Rare | Add a Jlore from the pile to every player's hand | T2 |
| Biology Project | 2 | Action | Rare | Add a Diamond from the pile to every player's hand | T2 |

### A.10 Draft Shop — Victory Point and scoring cards

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Kwzki Cultist | 2 | Points | Rare | +X VP, X = number of Kwzki Cultists in your deck | T2 |
| Courtyard of Squeam | 2 | Points | Rare | +X VP, X = floor(4 − avgDeckCost) | T2 |
| Library of Gods | 5 | Points | Rare | +X VP, X = ceil(avgDeckCost) | T2 |
| Whale Poaching | 4 | Points | Rare | +X VP, X = floor(deckSize / 12) | T2 |
| Tnack's Ingenuity | 4 | Points | Rare | +X VP, X = floor(5 − deckSize/12) | T2 |
| Fountain of Possibilities | 4 | Points | Rare | +X VP, X = floor(uniqueCardsInDeck / 4) | T2 |
| Marble Columns | 4 | Points | Epic | +X VP, X = floor(standard deviation of deck costs) | T3 |
| Stand Together | 9 | Points | Epic | +X VP, X = uniqueCardsInDeck | T2 |
| Treasure Vault | 8 | Points | Epic | +X VP, X = ceil(3 + Diamonds in deck) | T2 |
| Monumental Works | 5 | Points | Epic | +X VP, X = upgrades on a Relic in your deck (no double counting) | T3 (S-BUFF) |
| Ascendant Spread | 2 | Points | Rare | On gain, +1 or +2 VP — **only you know which** | T3 (S-HIDDEN) |
| Mercenary 280 | 3 | Action, Points | Epic | +280 VP iff the sum of your deck's costs is exactly 280 | T2 |
| Oh Mr. Lebon | 3 | Action, Points | Rare | If your Library is taller than every opponent's, score +2 VP **on this card** | T3 (S-PERSIST) |
| Tilted Towers | 3 | Points | Rare | +1 VP. Survives the first 2 trashings; on the second, rebuilds with +3 VP | T3 |
| Skyscraper | 3 | Token, Points | Token | +X VP (set on creation by The Conglomerate) | T2 |
| The Conglomerate | 3 | Action | Epic | Trash all VP cards in hand; add a Skyscraper worth their total VP to GY. +1 Action, +1 Card | T3 |
| Master of Jlore | 12 | Action, Points | Epic | Add a Jlore to GY. +1 Action, +1 Card, +3 VP | T1 |
| Constellation | 10 | Points, **End of Game** | Epic | At game end, per Constellation: trash the longest run of (1),(2),…,(X) cost cards and gain +X VP. Excluded from running VP | T4 (S-ENDGAME) |
| Star Aligner | 7 | Points, **End of Game** | Epic | At game end, +7 VP if exactly 7 cards in your deck cost (7) | T3 (S-ENDGAME) |
| Fist of Jraxxus | 4 | Action, Points | Rare | On play **or discard**, +2 Money. +1 VP | T2 |
| Carat | 1 | Action, Food, Token, Points | Token | Flimsy. +1 Money, +1 VP | T1 |
| Bullseye | 3 | Points | Rare | +1 VP. On discard: trash all (1)-or-less cards in hand; Nerf one card in each opponent's hand per trash | T3 (S-BUFF) |
| Mass Production | 1 | Action, Points | Rare | Add a copy of this to GY. +2 Actions, +2 Cards, −1 VP | T2 |
| Garlic | 0 | Action, Points, Food | Rare | When trashed, +7 Money. −1 VP | T2 |
| Lotto Ticket | 4 | Action | Rare | Shuffle a Tix into Library, then draw a Points card and gain Money equal to its cost | T2 |
| Tixatus | 6 | Action, Points | Epic | Play on Buy. Trash top 5 of Library; per Tix, +1 Money and +1 VP **on this**. +4 VP | T3 (S-PERSIST) |
| Squire of J | 2 | Action | Rare | Discard a Jlore for +4 Money | T2 |
| Lord of J | 4 | Action | Rare | Discard a Jlore to add a Jlore to your GY | T2 |
| Purple Rain | 5 | Action | Rare | Add a Tix or Robux at random to GY for each **Epic** in hand | T3 (rarity query) |
| Iced Up | 2 | Action | Rare | Discard any number of **Rares** from hand: +2 Money each | T3 (rarity query) |
| Yuya's Embrace | 5 | Action | Rare | Flimsy. Discover a Points card from the Known Universe | T3 |
| Chopped Chuzz | −1 | Points | Rare | When this attempts to Fuse, trash it instead. When trashed, +3 Actions. −1 VP | T3 (S-FUSE) |
| Cursed Pig | 0 | Token, Points | Token | −1 VP | T1 |
| Virtual Bank Robbery | 6 | Action | Common | Flimsy. Add a Robux and a Tix to GY | T1 |

### A.11 Draft Shop — attacks, PvP and opponent interaction

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Siphon Squad | 4 | Action, Legacy | Rare | Opponents discard by hand size (4+ → 2 cards, 2–3 → 1, 0–1 → 0). +2 Money | T3 |
| Quiet Quorum | 6 | Action | Rare | Each opponent with 5+ cards discards down to 4. +2 Actions, +2 Cards | T3 |
| Midnight Raid | 5 | Action | Rare | Opponents discard all Points cards in hand; +X Money for each. +1 Action, +1 Money | T3 |
| Thought Steal | 3 | Action | Rare | Copy 2 random cards from an opponent's Library to your hand | T3 |
| Spyglass | 3 | Action | Rare | Discover a card in an opponent's Library; put a copy on top of your Library | T3 |
| Griftah | 4 | Action | **Legendary** | Discover a card from your Library and one from an opponent's; swap them | T3 |
| Antics | 3 | Action | Rare | Recruit an Action from an opponent's Library, then return it to their GY | T3 |
| Corpo Espionage | 4 | Action | Rare | Reveal the top card of each opponent's Library; add a Temporary copy of one to hand. +1 Action | T3 |
| Ambush Bid | 2 | Action | Rare | Reveal your top card and a random opponent's; if yours costs more, +2 Money and draw it, else discard both. +1 Action | T3 |
| The Curator | 5 | Action | Epic | Reveal hand, note the cheapest card; each opponent must give you a card costing at least that from the Draft Shop or their hand. +1 Action | T3 |
| Bribe | 3 | Action | Rare | Flimsy. Discover a card in an opponent's hand to steal; give them a Diamond | T3 |
| Corruption Scandal | 3 | Action | Epic | Flimsy. Steal an opponent's entire hand; give them 5 Diamonds | T3 |
| Firing Squad | 3 | Action | Rare | Flimsy. Discover a card in an opponent's hand to trash | T3 |
| Polymorph | 3 | Action | Rare | Transform a random card in an opponent's hand into a Copper | T2 |
| Counter Spell | 5 | Action, Legacy | Epic | The next Action your opponent plays is discarded instead (they don't lose the Action). +1 Action | T3 |
| Aggressive Taxation | 5 | Action | Epic | The Money from the next Resource an opponent plays is given to you next turn | T3 |
| Meta Shift | 2 | Action | Rare | Each player passes a card from hand to the next player. +2 Cards | T3 |
| Clipped Wings | 3 | Action | Rare | Until your next turn, opponents gaining a (6)+ card also gain a Cursed Pig. +1 Action | T3 |
| Baby Witch | 4 | Action | Common | Add a Cursed Pig to each opponent's GY | T2 |
| Mother Witch | 7 | Action | Rare | Each opponent Discovers a card in hand to turn into a Cursed Pig | T3 |
| Weasel Turner | 1 | Action | Rare | Shuffle 3 copies of Weasel Turner into opponents' decks | T2 |
| Ancient Curse | 7 | Action, Legacy | Epic | −7 VP. Shuffle a copy into an opponent's deck (the copy lacks this clause) | T3 |
| Profe Yates Unleashed | 5 | Action, Legacy | **Legendary** | Trash all cards in opponents' hands containing any letter of M,O,O,S,E | T3 |
| Hired Shrimp | 5 | Action, Legacy | **Legendary** | Trash all cards in opponents' hands with fewer words than this card (16 words) | T4 (self-referential text) |
| Pickle | 3 | Action, Legacy | Epic | +1 Action. Next turn each opponent chooses: −2 Money, discard a random card, or give you a Gold | T3 |
| Ebon Hand | 4 | Action | Rare | Add a copy of the last card an opponent discarded to GY (most expensive if multiple). Preview shown | T3 |
| Rebellion | 13 | Action | Epic | Opponents discard their hands | T2 |
| Coronation | 8 | Action | Epic | Shuffle a Rebellion into an opponent's deck. +4 VP, +4 Actions, +4 Buys, +4 Cards, +4 Money | T2 |
| Loot Attack | 4 | Action | Rare | Flimsy. Add 2 Grubbing Goblins to GY; per Goblin in deck, steal a Gold from a random opponent to GY | T3 |
| War! | 6 | Action | Epic | All reveal top card; cast yours; highest cost takes the rest. Ties re-bet 3 more cards | T3 |
| Edge of Tomorrow | 12 | Action | **Legendary** | Flimsy. Manifest Celestial Aura *Aspect of Ares* (only War! playable; gain a War! each turn) | T4 (S-AURA) |
| Doomsday Clock | 9 | Action, PvP | **Mythic** | Play on Buy, Flimsy. Game ends 3 turns from now; any player replaying this resets the timer | T3 |

### A.12 Draft Shop — Warhero Token archetype

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Warhero Token | 3 | Action, Points, Warhero Token | Token | +1 Action, +1 Money, +1 VP | T1 |
| False Hero | 2 | Action | Common | Add a Flimsy Warhero Token to GY. −1 Money | T1 |
| Tylannt | 5 | Action | Rare | Add a Warhero Token to the top of Library. +1 Action, +1 Card | T2 |
| Aura Farming | 4 | Action | Common | Add 2 Flimsy Warhero Tokens to GY | T1 |
| Aura Gambit | 3 | Action | Rare | Give each opponent a Flimsy Warhero Token with "when trashed, give it to [you]". +1 Action | T3 |
| Generational Aura Debt | 4 | Action | Epic | Replace the top 4 of Library with Flimsy Warhero Tokens. −4 Money next turn | T3 |

### A.13 Draft Shop — Felinor (cat) archetype

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Felinor | 0 | Action, Token, Felinor | Token | Flimsy. +2 Cards | T1 |
| Recurring Felinor | 1 | Action, Felinor, Legacy | Epic | +2 Cards. When trashed, goes to the current player's GY | T3 |
| Felinor Feelings | 1 | Action | Common | Add a Felinor to hand and one to each opponent's GY | T2 |
| Two Mans | 2 | Action | Rare | Trash another card in hand: if Felinor, draw your most expensive card, else add a Felinor to hand. +1 Action | T2 |
| All Night Baby | 2 | Action | Common | Trash a card in hand for +1 Action; if Felinor, +3 Actions | T2 |
| Lord of the Cave | 5 | Action | Rare | Add a Felinor to GY. You may trash a Felinor in hand to add a Robux to GY | T2 |
| Mewing | 5 | Action | Epic | Discover a Known Universe Action; add a Felinor to GY that plays it when trashed | T3 |
| Nine Lives Loan | 2 | Action | Rare | Trash a Felinor from hand for +3 Money; put a Felinor on top of Library. +1 Action | T2 |
| Night on the Town | 3 | Action | Rare | Choose: all Felinors in hand → Robux, or all Robux in hand → Felinors. +1 Action | T2 |
| Felinor Factory | 4 | Action | Rare | Add a Felinor to hand; if you trashed a Felinor this turn, +2 Money, +1 Card. +1 Action | T2 |
| Box of Kitties | 4 | Action | Common | Add 2 Felinors to hand; if you trash one this turn, +1 Buy. +1 Action | T2 |
| Maid Dress | 2 | Action | Rare | On buy, add a Felinor to GY. On play, trash a Felinor in hand and replace it with an SSR+ Catboy Maid | T3 |
| SSR+ Catboy Maid | 5 | Action, Points, Felinor | Epic | Flimsy. +2 Cards, +2 VP | T1 |
| Chonker | 4 | Action, Felinor | Rare | Big Action 2. +4 Cards. When trashed, add a Food to hand | T3 (S-BIGACTION) |
| Took Him to the J'O | 5 | Action | Epic | Add a Felinor to GY with "when trashed, trash the top 2 of each opponent's Library; steal any costing (6)+" | T3 |
| Grinder Veteran | 3 | Action | Rare | Recruit a Flimsy card; if it was a Felinor, add 2 Warhero Tokens to hand | T3 |
| The Menagerie | 1 | Action | Rare | Add a Felinor and a Cursed Pig to GY. +2 Actions, +2 Money | T2 |
| Spider E.B. | 2 | Action | Rare | Add 2 Felinors with 1 Plague Token each to GY. +1 Action, +2 Cards | T3 (S-PLAGUE) |
| CN Auspicious Kitty | 4 | Action, CN | Rare | Add a Felinor to hand with either +2 Money or +2 VP. +1 Action | T2 |

### A.14 Draft Shop — Books

Books are (1)-cost Tokens, all **Temporary**, all granting +1 Action. They are generated, never bought.

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Book of Lethal Kill | 1 | Token, Book, Legacy | Token | +13 Money and +13 Buys iff your deck's total cost is divisible by 13 | T2 |
| Book of Conspiracy | 1 | Token, Book, Legacy | Token | +3 Prophet | T1 |
| Book of Books | 1 | Token, Book, Legacy | Token | Add two Books to hand | T2 |
| Book of Flame | 1 | Token, Book, Legacy | Token | Trash a card in hand for +5 Money | T2 |
| Book of Knowledge | 1 | Token, Book, Legacy | Token | +5 Cards | T1 |
| Book of Random | 1 | Token, Book | Token | Add 1–5 random Entire-Universe cards to hand | T3 |
| Book of Frost | 1 | Token, Book | Token | Opponents discard down to 1 card | T3 |
| Book of Curses | 1 | Token, Book | Token | Add 3 Cursed Pigs to opponents' GYs | T2 |
| Book of Greed | 1 | Token, Book | Token | Add 3 random shop cards to hand | T2 |
| Book of Felinors | 1 | Token, Book | Token | Each player discards 2 at random and gains 2 Felinors in hand | T3 |
| Book of Blood | 1 | Token, Book, Legacy | Token | Give 3 Action cards in opponents' decks Flimsy + "when trashed, add an original copy to their hand" | T3 |
| Book of Moon | 1 | Token, Book | Token | Add a Lunar Fragment to hand | T1 |
| Library Card | 2 | Action | Common | Flimsy. Add a Book to hand. +1 Action | T2 |
| Premium Library Card | 5 | Action | Rare | Add a Book to hand. +1 Action | T2 |
| Premium Premium Library Card | 9 | Action | Epic | Add 2 Books to hand. +1 Action | T2 |
| Shockwave's Dream | 7 | Action | Epic | Trash your hand; add X Books, X = cards trashed / 2. +1 Action | T2 |
| Archivist | 6 | Action | Rare | Choose: add a Temporary Book to hand, **or** remove Temporary from all Books in hand. +1 Action | T3 |
| Back to the Raq | 5 | Action | Rare | Trash 2 random cards in your Library to drop 2 Books into GY | T2 |

### A.15 Draft Shop — Relics

Relics permanently upgrade themselves. This is the cleanest S-BUFF/S-PERSIST showcase.

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Relic of Fortune | 1 | Action, Relic | Common | +1 Money. Permanently upgrade this | T3 |
| Relic of Vigor | 1 | Action, Relic | Common | +1 Action. Permanently upgrade this | T3 |
| Relic of Insight | 1 | Action, Relic | Common | +1 Card. Permanently upgrade this | T3 |
| Relic of Desire | 1 | Action, Relic | Common | +1 Buy. Permanently upgrade this | T3 |
| Relic of Glory | 3 | Action, Points, Relic | Rare | +1 VP. Permanently upgrade this | T3 |
| Relic of Furitiveness | 1 | Action, Relic | Rare | +1 Card, +1 Money. Upgrades whenever you trash a Felinor | T3 |
| Relic of Finesse | 1 | Action, Relic | Rare | +1 Action, +1 Buy. Upgrades whenever a pile is unlocked | T3 |
| Relic of Dominion | 5 | Action, Relic | Epic | +1 Money, +1 Action, +1 Card. Permanently upgrades one of the three at random | T3 |
| Relic of Totality | 5 | Action, Relic | Epic | Big Action X, Combo X. +X to Action/Buy/Money/Cards/VP. On buy X=1; permanently upgrade (X++) | T4 |
| Evercrown | 8 | Action, Points | Epic | +1 to all five stats. Permanently upgrades **all** stats | T3 |
| Bag of Relics | 5 | Action | Rare | Flimsy. Add 3 Relics to hand. +1 Action | T2 |

### A.16 Draft Shop — Food, Distilled and Grapes

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Gruel | 0 | Action, Food, Token | Token | Flimsy. (No effect) | T1 |
| Crumb | 1 | Action, Food, Token | Token | Flimsy. +1 Action, +1 Card, +1 Money | T1 |
| Brownie | 1 | Action, Food, Token | Token | Flimsy — **loses Flimsy if on the edge of your hand**. +2 Cards, +1 Action | T3 (hand adjacency) |
| Banana | 1 | Action, Food, Token | Token | Flimsy. Discover a Known Universe card costing (1) or less. +1 Action | T3 |
| Rosemary Triscuit | 1 | Action, Food, Token | Token | Flimsy. Add a Crumb to GY. +3 Gold in 3 turns | T2 |
| Fuit Gummy | 2 | Action, Food, Token | Token | Flimsy. +1 Action per **rarity** present in your hand | T3 (rarity query) |
| Matcha | 2 | Action, Token, Food | Token | Flimsy. +4 Actions, −2 Money | T1 |
| Boba | 2 | Action, Token, Food | Token | Flimsy. +3 Actions, −2 Money. Add a Felinor to hand | T1 |
| Slop Bowl | 3 | Action, Food, Token | Token | Flimsy. Big Action 2. +4 Actions | T3 |
| Combo Meal | 2 | Action, Food, Token | Token | Flimsy. +2 Actions. Combo 2: +1 Action | T3 |
| Huckleberry | 3 | Action, Food, Token | Token | Flimsy. Draw all Food in your Library. +1 Action | T2 |
| Loaf of Bread | 3 | Action, Food | Rare | Flimsy. Also play the cards sandwiching this in hand. Add a Slice of Bread to GY | T3 (hand adjacency) |
| Slice of Bread | 2 | Action, Food | Token | Flimsy. Draw your most expensive Library card. Add a Crumb to GY. +1 Action | T2 |
| Potato | 2 | Action, Food | Rare | Flimsy. When discarded, transforms into Distilled Potato. +3 Cards, +1 Action | T3 |
| Distilled Potato | 4 | Action, Food, Token, Distilled | Token | Flimsy. End of turn: trash your hand and a random card from each opponent's hand. +4 Cards, +2 Actions | T3 |
| Distilled Gluten | 1 | Action, Food, Token, Distilled | Token | Flimsy. Trash the cheapest card in each player's hand. +2 Actions, +1 Card | T3 |
| Grapevine | 4 | Action | Rare | Flimsy. Add 4 Grapes to GY (79% normal / 20% big / 1% golden). On discard, upgrade to add 2 more | T3 |
| Grape | 1 | Action, Food, Token | Token | Flimsy. Play a random Action in hand. On discard, becomes Distilled Grape. +1 Action, +1 Card | T3 (recursion risk) |
| Distilled Grape | 2 | Action, Food, Token, Distilled | Token | Flimsy. Play 2 random Actions in hand, then trash them. +2 Money, +1 Action, +1 Card | T3 |
| Big Grape | 5 | Action, Food, Token | Token | Flimsy. Play **all** Actions in hand at random. +1 Action, +1 Card | T3 |
| Golden Grape | 6 | Action, Food, Gold | Token | Flimsy. Play a random Legendary Action. On discard, add a random Legendary to GY. +3 Money, +1 Action, +1 Card | T3 |
| Fruit Basket | 4 | Action | Common | Add a random Food to hand. +1 Action | T2 |
| Hearty Meal | 4 | Action | Rare | Flimsy. Add 3 random Foods to hand. +1 Action | T2 |
| House Party | 3 | Action | Rare | Flimsy. Add 3 random Foods to hand, at least one Distilled. +1 Action, −1 Money | T2 |
| Cornucopia | 6 | Action | Epic | End of turn: if you used no Buys, shuffle 10 random Foods into Library | T3 |
| Miracle Fruit | 10 | Action, Food | **Legendary** | Flimsy. Discover a Miracle (see Appendix B.1) | T3 |
| Blueberry Pie | 7 | Action, Food | Epic | Flimsy. Add 3 random **Rare** Actions from the Known Universe to hand | T3 (rarity query) |
| Jmart Banana Bunch | 5 | Action, Food, Token | Rare | Temporary. Add 5 Bananas to hand; Nerf some at random | T3 (S-BUFF) |
| Conjure Rosemary Triscuits | 2 | Action | Common | Add 2 Rosemary Triscuits to hand | T1 |
| Better Budder | 4 | Action | Rare | All Food in hand → Gold; all Gold in GY → Food. +1 Action | T2 |
| Goatman Family Genetics | 3 | Action | Rare | Add a Distilled card to each player's hand; remove Flimsy from yours | T3 |
| Performance Enhancing Cookie | 5 | Action, Food | Epic | Flimsy. +1 Action. The next card you play is **Buffed 5×**. Add a PE Crumb to GY | T4 (S-BUFF) |
| Performance Enhancing Crumb | 2 | Action, Food | Rare | Flimsy. +1 Action. The next card you play is Buffed 2× | T4 (S-BUFF) |
| BOOM! Big Max | 1 | Action | Epic | On discard, gain a Plague Token. Only active at 5+ tokens: add a Jlore to GY, +3 VP, +1 Action, +1 Card | T4 (S-PLAGUE + S-PERSIST) |

### A.17 Draft Shop — Eggs

All Eggs are (0)-cost Flimsy Tokens granting +1 Action. Standard drop table: **70% Normal / 15% Big / 9% Golden / 5% Rotten / 1% Diamond**.

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Egg | 0 | Action, Token, Egg, Food | Token | Flimsy. +1 Action. Randomly +1 Money / Buy / Card / Action | T2 |
| Big Egg | 0 | Action, Token, Egg, Food | Token | Flimsy. +1 Action. Randomly +2 Money / Buy / Card / Action | T2 |
| Golden Egg | 0 | Action, Token, Egg, Food | Token | Flimsy. +1 Action. Randomly three (repeatable) of +1 Money / Buy / Card / Action | T2 |
| Diamond Egg | 0 | Action, Token, Egg, Food | Token | Flimsy. +1 Action. Randomly three (repeatable) of +2 Money / Buy / Card / Action | T2 |
| Rotten Egg | 0 | Action, Token, Egg, Food | Token | Flimsy. −5 Points | T1 |
| Tiny Carton of Eggs | 4 | Action | Common | Flimsy. +1 Action. Add 3 random Eggs to hand | T2 |
| Chicken Coup | 5 | Action | Common | +1 Action. Add 3 random Eggs to hand | T2 |
| Small Carton of Eggs | 6 | Action | Rare | Flimsy. +1 Action. Add 6 random Eggs to hand | T2 |
| Dozen Eggs | 8 | Action | Rare | Flimsy. +1 Action. Add 12 random Eggs to hand | T2 |
| Bulk Eggs | 11 | Action | Epic | Flimsy. +1 Action. Add 24 random Eggs to hand | T2 |
| Hen | 3 | Action | Rare | +1 Action. Add a random Egg or Feather (35% Feather / 35% Egg / 15% Big / 9% Golden / 5% Rotten / 1% Diamond) | T2 |

### A.18 Draft Shop — Plague archetype

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Crop Dusting | 2 | Action, Legacy | Rare | 1 Plague Token on the top card of all shop piles. +2 Money if any had none | T3 |
| Plague Crawler | 1 | Action, Legacy | Rare | 1 Plague Token on a random card in GY. When a token is placed on this, the placer gets +2 Cards. +1 Action | T3 |
| Plague Charger | 3 | Points, Legacy | Rare | On purchase you may trash this to put 3 Plague Tokens on a GY card. +X VP, X = tokens on this | T3 |
| Patient Zero | 2 | Action | Rare | Plague Token on a Draft pile's top card; if any card gained this turn had a token, +2 Cards. +1 Action | T3 |
| Outbreak | 1 | Action, Legacy | Rare | Plague Token on the top card of two random piles; then gain any shop card whose tokens exceed its cost. +1 Action | T3 |
| Antibody Extraction | 2 | Action | Rare | Plague Token on a random hand card; trash up to 2 plagued hand cards for +1 Card and +1 Money each. +1 Action | T3 |
| Living Bomb | 2 | Action, Legacy | Rare | Trash all plagued cards in Shop and GYs; then 1 token on a random card in each opponent's GY. +1 Action | T3 |
| Plandemic | 4 | Action | Epic | Double all Plague Tokens in Shop and GYs and respread them (min 1); add copies of cards whose tokens equal their cost to hand (min 1). +1 Action | T4 |
| Jalshi | 5 | Action | Epic | Choose: plague all cards in hand, **or** remove all hand Plague Tokens for +X Money | T3 |
| Juhan Wet Market | 2 | Action, CN | Rare | On discard, +2 Plague Tokens on this. +X Cards, X = tokens on this. +1 Action | T3 |

### A.19 Draft Shop — Soul Shards

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Soul Shard | 0 | Action, Token | Token | Play on Draw, Flimsy. Add a Tix to GY | T2 |
| Soul Jailor | 2 | Action | Common | Add 2 Soul Shards to GY. +1 Action, +1 Card | T1 |
| Soul Slicer | 4 | Action | Rare | Combo 1: trash the last card you played to add 2 Soul Shards to GY and +3 Actions | T3 (S-COMBO) |
| Luckysoul Hoarder | 4 | Action | Rare | +1 Buy. Add 2 Soul Shards to GY. Gain Money equal to your Buys | T2 |
| Soulcologist Mike Kwzka | 5 | Action | **Legendary** | Add a Book to GY for each Soul Shard in your deck. +2 Actions | T2 |
| Soul Shard Lapidary | 5 | Action, Tribal | Epic | Destroy a Soul Shard to add a Flimsy Known Universe card costing (5)+ to hand | T3 |

### A.20 Draft Shop — Grubbing Goblins

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Grubbing Goblin | 0 | Action, Token | Token | Play on Draw, Flimsy. +2 Money | T2 |
| Goblin Gang Boss | 3 | Action | Common | Add a Grubbing Goblin to GY. +2 Money | T1 |
| Nether Portal | 5 | Action | Rare | When discarded, add 2 Grubbing Goblins to GY | T2 |
| Jakkari Sacrifice | 5 | Action | Rare | When discarded, add a Nether Portal to GY | T2 |
| War Bonds | 4 | Action | Rare | Play on Buy, Flimsy. +1 Buy. Add 3 Grubbing Goblins to GY | T2 |
| CN Backed War Bonds | 8 | Action, CN | Epic | Play on Buy, Flimsy. +1 Buy. Add 5 Grubbing Goblins and a War! to GY | T2 |
| The Mob | 4 | Action | Rare | Every card you buy this turn also adds a Grubbing Goblin to GY | T2 |
| Uncle Musabi | 4 | Action | **Legendary** | Flimsy. Transform all (2)-or-less cards in Library into Grubbing Goblins. +1 Card | T3 |
| Skull of Jul'dan | 5 | Action | Rare | +3 Cards; for each drawn card costing (0), +3 Money and trash it | T2 |

### A.21 Draft Shop — Truss

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Truss | 3 | Action, Truss | Common | +2 Actions, +1 Card | T1 |
| Big Truss | 4 | Action, Truss | Rare | Big Action 2. +3 Actions, +4 Cards | T3 |
| Nap | 2 | Action, Truss | Rare | Big Action 3. +1 Card, +1 Action for the next two turns | T3 |
| Truss Monk | 5 | Action, Truss | Rare | Add a Truss to GY. +1 Action, +1 Card | T1 |
| Truss Trust | 5 | Action, Truss | Rare | Flimsy. Add 2 Tix and 2 Truss to GY | T1 |
| Truss Flick | 4 | Action, Truss | Rare | Flimsy. Trash a Truss for +3 Cards and +6 Actions | T2 |
| 401J | 5 | Action, Truss | Epic | Add a Truss Trust, a Grubbing Goblin and a Soul Shard to GY | T2 |

### A.22 Draft Shop — CN archetype

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| RCT CN | 1 | Action, CN | Rare | Flimsy. +1 Action. Next card played gains the CN tag. Buff all CN cards in your deck | T4 (S-BUFF) |
| CN-phobia | 2 | Action, CN | Rare | Flimsy. +1 Action, +3 Money, +1 Card. Trash a CN card in an opponent's deck; if successful, +2 Money | T3 |
| CNcias | 3 | Action, CN | Rare | Discover a Known Universe card costing (2) or less **not currently in the match**; add to hand with a Plague Token. +1 Action | T3 |
| CN Developer | 3 | Action, CN | Rare | On play, add an Upcycle to GY. On end-of-turn discard, add two Upcycles to GY | T2 |
| CN Century of Humiliation | 4 | Action, CN | Epic | Replace hand with cards costing (1) more, then Nerf them. +1 Action | T4 (S-BUFF) |
| CN Tech | 6 | Action, CN, Legacy | Rare | Add a (5)-or-less shop card to hand. +1 Action | T2 |
| CN Century of Prosperity | 8 | Action, CN | Epic | +8 Money, +1 Action. Add a random CN card to every player's hand | T2 |
| CN Succulent Xiao | 1 | Action, Food, CN, Token | Token | Flimsy. +1 Action, +1 Buy, +1 Card | T1 |
| Performativity | 5 | Action | Epic | Discover from a Book, a Food and a CN card to add to hand. +1 Action | T3 |

### A.23 Draft Shop — Combo, Ricochet and variable stat blocks

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Group Leader | 3 | Action | Rare | +1 Action, +1 Card. Combo 1: cast twice | T3 |
| Experience Dividend | 3 | Action | Rare | +1 Action. Combo X: +X Money | T3 |
| Crime Wave | 5 | Action | Epic | +2 Actions. Reset your Combo. Combo 3: return this to hand | T3 |
| Wombo Combo | 1 | Action | Epic | +1 Action. Combo 1: permanently gain the Combo clause of a random Combo card | T4 (S-PERSIST) |
| Ricochet | 3 | Action, Ricochet | Rare | Combo 3: return a random Action played this turn to hand, +1 Action. One Ricochet per turn | T3 |
| Ricochet+ | 6 | Action, Ricochet | Epic | Combo 3: return 2 different Actions, +2 Actions. One Ricochet per turn | T3 |
| Ricochet++ | 8 | Action, Ricochet | Epic | Combo 3: return 3 different Actions, +3 Actions. One Ricochet per turn | T3 |
| Money Moves | 5 | Action | Rare | Cast on Buy. +2 Actions | T1 |
| Holy Topdeck | 5 | Action | Rare | +1 Card, then gain a random mix of Actions/Buys/Cards/Money totalling its cost | T2 |
| Boots on the Ground | 3 | Action, Legacy | Rare | +1 Action, +1 Card. Repeat if this was the first card played this turn | T2 |
| Insidious Initiation | 1 | Action | Rare | Discard another Insidious Initiation: +2 Actions, +2 Cards | T2 |
| Full House | 5 | Action | Rare | Discard a Full House for +5 Cards and +5 Money. +1 Action | T2 |
| Another Round? | 3 | Action | Rare | Give the top 2 Library cards +1 Card and +1 Money until end of turn. +1 Card, +1 Money | T3 |
| Vault | 5 | Action | Rare | Big Action 5, Flimsy. Add two Diamonds to hand | T3 |
| Safe | 4 | Action | Rare | Big Action 4, Flimsy. Add two Gold to hand | T3 |
| Silver Stash | 3 | Action | Common | Big Action 3, Flimsy. Add two Silver to hand | T3 |
| Moon Rock | 3 | Action | Rare | Big Action 3. Add a Lunar Fragment to hand | T3 |
| Dynamic Stat Allocation | 6 / 8 / 10 | Action | Epic | Big Action X, Combo X, Recruit X, and +X to all six stats. X = 2/3/4 by purchase price | T4 |
| Too Many Stats | 2–10 (rerolled) | Action | **Legendary** | Every value — cost, Big Action, Combo, Recruit, and all six stats (−3 to 3) — rerolls each turn | T4 |
| Synchro Summon | 1 | Action | Rare | Discard 2 same-cost cards to Recruit an Action of that cost. +1 Action, +1 Card | T3 |
| Ritual Summon | 1 | Action | Rare | Trash a random hand card to Recruit an Action of that cost. +1 Action, +1 Card | T3 |
| Fusion Summon | 4 | Action | Rare | Discard 2 cards to Recruit an Action costing their sum. +1 Action, +1 Card | T3 |
| Link Summon | 4 | Action | Rare | Discard 3 cards to Recruit your most expensive Action. +1 Action, +1 Card | T3 |
| Cookie Guild | 2 | Action, Legacy | Common | Recruit an Action costing (3) or less | T2 |
| The Big Boys | 6 | Action | Rare | Recruit an Action costing (5) or more | T2 |
| King Varian | 7 | Action | **Legendary** | Recruit the top 3 cards of your Library | T2 |
| Jeweled Scarab | 2 | Action | Common | Play on Buy, Flimsy. Discover a (3)-cost Known Universe card to GY | T3 |
| Golden Scarab | 3 | Action | Rare | Play on Buy, Flimsy. Discover a (4)-cost card to GY; when played, Gold is added to the options | T3 |
| Empyreal Scarab | 4 | Action | Rare | Play on Buy, Flimsy. Discover a (5)-cost card to GY; when played, Discover a (6)-cost instead | T3 |

### A.24 Draft Shop — recursion, copying and replay

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Solar Eclipse | 2 | Action | Rare | Flimsy. Double the next card you play | T3 (S-MULTIPLIER) |
| KY's Chosen | 6 | Action | Epic | Flimsy. The next card you play gains ×2 Buy, ×2 Money, ×2 Draw, ×2 Action. +1 Action | T3 |
| Misery | 4 | Action | Epic | Replay every Action you've played this turn, in order, with random targets; then trash them all | T3 (recursion risk) |
| Drain Game | 1 | Action | Rare | Replay every Resource you've played this turn, in order; then trash them all | T2 |
| Spell Tyrant | 7 | Action, Legacy | Epic | Cast 3 random Actions from your GY (random targets) | T3 |
| Mathemagiks | 5 | Action | Epic | Discover a Known Universe Action or Resource costing (handSize) and cast it | T3 |
| The Past | 5 | Action | Epic | Is a copy of the last card you played | T3 |
| The Future | 5 | Action | Epic | Is a copy of the next card you will play | T4 |
| The Eternal Show | 10 | Action | **Mythic** | If your The Past would play your The Future and it plays this, trash your opponent's deck | T4 (paradox loop) |
| Right Hand Man | 7 | Action | Epic | Flimsy. +1 Action. The next card played gains "at the start of your turn, add this to your hand from anywhere" | T4 |
| Card Mastery | 7 | Action | Epic | Flimsy. +1 Action. The next Action played gains Play on Draw (random targets) | T3 |
| Infini Scepter | 7 | Action, Legacy | **Legendary** | Flimsy. +1 Action. The next Action played is bound to Celestial Aura *Oathbound Memory* | T4 (S-AURA) |
| Echo Forge | 5 | Action | Rare | *(see A.7)* | T3 |
| Ancient Acquisition | 4 | Action, Legacy | Epic | Discover a card from GY to hand, then repeat (excluding Ancient Acquisition). +1 Action | T3 |
| Back From the GY | 7 | Action, Legacy | Epic | Choose: 4 GY Actions costing 0–2, 2 costing 3–4, or 1 costing 5–7. Add to hand. +3 Actions | T3 |
| Pointer | 4 | Action | Epic | +1 Action. The next card played is Pointed to: they are Played/Mutilated/Trashed together | T4 (Mutilate undefined) |
| Hivemind | 3 | Action | Epic | +1 Action. The next card played gains Flimsy; **this card permanently gains its effects** | T4 (S-PERSIST) |
| Homebrew | 3 | Action | Epic | Discover a (1)-cost Known Universe card and permanently add its effect to this card, then upgrade it | T4 (S-PERSIST) |
| 1/12th In the Light | 5 | Action | Epic | Transform every 12th card in your deck into a copy of a card in your hand | T3 |
| Pashes the Pie Rat | 1 | Action | **Legendary** | Whenever you play a (1)-cost **Legendary**, Recruit this. +1 Card | T3 |

### A.25 Draft Shop — Discover, generation and rarity pulls

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Pandora's Box | 5 | Action | Rare | Discover an Entire Universe card to hand. +1 Action | T3 |
| Lag in the System | 2 | Action, Legacy | Rare | Add one of each (0)- and (1)-cost shop card to hand. +1 Action | T2 |
| Epic Fate | 5 | Action | Rare | Flimsy. Add a random **Epic** from the Known Universe to hand. +1 Action | T3 |
| Legendary Destiny | 8 | Action | Epic | Flimsy. Discover a **Legendary** from the Entire Universe to hand. +1 Action | T3 |
| Zephrys | 10 | Action | **Legendary** | Discover the perfect card for your hand. +1 Action | T4 (S-SIM) |
| Wardrum's Mystery Box | 8 | Action | **Legendary** | Flimsy. Cast 5 random Entire Universe Actions (random targets) | T3 |
| Wardrum's Bold Prediction | 8 | Action | **Legendary** | Flimsy. Transform your deck into random Known Universe cards | T3 |
| Predatory Monetization | 10 | Action | Epic | Flimsy. +1 Action. Open a card pack: 5 cards at Hearthstone pack odds; golden pulls also give a Gold | T4 (rarity model) |
| Alien Dropshipping | 6 | Action | Rare | Play on Buy, Flimsy. Shuffle 3 random (6)-cost Entire Universe cards into Library with Flimsy | T3 |
| A Gaze into the Past | 6 | Action | Epic | +1 Action. Add a random **Legacy** card from the Entire Universe to hand | T3 (Legacy tag) |
| A Glimpse of the Past | 3 | Action | Rare | Flimsy. +1 Action. Add a random Legacy card from the Entire Universe to hand | T3 |
| Second Time Around | 5 | Action | Epic | Discover a card from a simulated reality where you win | T4 (S-SIM) |
| Infinite Realities | 20 | Action | **Mythic** | Play on Buy, Flimsy. Replace hand, Library and GY with a deck from a reality where you win | T4 (S-SIM) |
| Call to Chaos | 6 | Action | Epic | ??? — one of 30+ effects (Appendix B.2) | T4 |
| Craft a Card | 1 / 5 / 10 | Action, Legacy | Epic | Flimsy. Craft a card from two Discover menus scaled by price (Appendix B.3) | T4 |
| What is Love? | 9 | Action | Epic | Discover 2 Known Universe cards to Fuse and add to hand — **twice**. +2 Actions | T4 (S-FUSE) |
| Matchmaker | 4 | Action | Epic | Fuse 2 random non-fused cards in your Library. +1 Action | T4 (S-FUSE) |
| Freaky Phil | 6 | Action | **Legendary** | Fuse 3 random non-fused cards in your Library. +1 Action | T4 (S-FUSE) |
| Frankenstein | 3 | Action | Epic | Flimsy. +1 Buy. First purchase refunds 50% (round down); the next purchase fuses with the previous | T4 (S-FUSE) |

### A.26 Draft Shop — Buff, Nerf and card mutation

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Universal Buff! | 4 | Action, Legacy | Epic | Flimsy. Choose a Draft pile; randomly Buff **all copies wherever they are** | T4 (S-BUFF, definition scope) |
| Universal Nerf! | 4 | Action, Legacy | Epic | Flimsy. Choose a Draft pile; randomly Nerf all copies wherever they are | T4 |
| Quick Patch | 2 | Action | Rare | Play on Draw. Buff a random card in your deck (prioritize hand) | T3 |
| Indirect Buffalo | 3 | Action | Rare | +1 Action, +1 Card. Whenever a card in your deck is Buffed, this is Buffed too | T3 |

### A.27 Draft Shop — Lunar and cosmic

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Lunar Fragment | 6 | Action, Lunar Fragment | Token | Flimsy. +3 to **all six** stats (VP, Actions, Buys, Cards, Money) | T1 |
| Journey to the Moon | 3 | Action | Epic | +1 Action, +1 Card. On the 25th play this game, shuffle 10 Lunar Fragments into your deck (live counter) | T4 (S-PERSIST) |
| Astrologist | 2 | Action | Rare | Flimsy. +1 Action. On every even-numbered Astrologist trashed this game, add a Lunar Fragment to hand | T4 (S-PERSIST) |
| Moon Dance | 4 | Action | Rare | Flimsy. At the start of your 3rd turn from now, add a Lunar Fragment to hand | T2 |
| Space Race | 6 | Action, Lunar Fragment | Epic | Also gives an opponent a Lunar Fragment. +3 to all six stats | T2 |
| Wish Upon the Stars | 3 | Action | Epic | +1 Action, +1 Card. On the **100th** play this game, summon Hypercelestial Aura *Shooting Star* | T4 (S-PERSIST) |
| Runebinder of Jlore | 5 | Action | Epic | Put this on top of Library. Add a Jlore to GY on the 7th, 9th, 13th, 14th, 18th, 21st, 26th, 27th, 28th play. +1 Action | T4 (S-PERSIST) |
| Arc of the Universe | 3 | Action | **Mythic** | +1 Action. Full 3-D gravitational alignment minigame; +999 VP within 1° of the Center of the Universe | T4 (own spec) |
| Eastern Metaphysics | 5 | Action | Epic | Track the last 3 Auras from Actions played; assign each owned Action a Positive or Negative Aura; consume 3 for one of four payoffs. **Vainglorious accounts only** | T4 |
| Constellation | 10 | Points, End of Game | Epic | *(see A.10)* | T4 |
| Star Aligner | 7 | Points, End of Game | Epic | *(see A.10)* | T3 |

### A.28 Draft Shop — time, meta and game-warping

| Card | Cost | Types | Rarity | Effect | T |
|---|---|---|---|---|---|
| Chron Job | 3 | Action | Rare | Put this 6th from the top of your deck after playing. +1 Action, +2 Money | T3 |
| Chron Break | 10 | Action | **Mythic** | Cast on Draw, Flimsy. End your turn. Take another one | T3 |
| 25th Hour | 3 | Action | Epic | After your 25th turn, immediately take an extra turn (one per copy) | T4 (S-PERSIST) |
| Outsourcing R&D | 8 | Action | **Legendary** | Flimsy. On the 3rd play this game, manifest Hypercelestial Aura *Lotus Solutions* — an AI plays a second turn for you every turn | T4 (S-AI) |
| Conjure Aura | 12 | Action | Epic | Flimsy. Manifest a Celestial Aura | T3 (S-AURA) |
| Hero's Power | 5 | Action | Epic | Flimsy. Discover a Heroic Aura for your field | T3 (S-AURA) |
| Hero's Recall | 3 | Action | Rare | If you have 3+ Money, spend 3 and add a Hero's Recall to GY; at 5 in hand, trash them and Discover a Heroic Aura. +1 Action | T3 |
| Quest Accepted! | 1 | Action | Epic | On buy, manifest Celestial Aura *In Too Deep*, then trash this | T4 (S-QUEST) |
| A Duel of Wits | 4 | Action | Epic | +4 Cards if you correctly answer a randomized logarithmic inequality about deck statistics | T4 |
| Paper Sculpture | 6 | Action | Epic | +2 to all five stats. If trashed, stolen or removed from your deck in any way, trash 10 random cards from your deck | T3 |
| Mercenary 280 | 3 | Action, Points | Epic | *(see A.10)* | T2 |
| Doomsday Clock | 9 | Action, PvP | Mythic | *(see A.11)* | T3 |

### A.29 Remaining Tokens (generated only, never purchasable)

| Token | Cost | Types | Created by |
|---|---|---|---|
| Felinor | 0 | Action, Token, Felinor | Felinor Feelings, Lord of the Cave, Box of Kitties, Mewing, The Menagerie, Maid Dress, CN Auspicious Kitty, Book of Felinors, Boba, Spider E.B. |
| Cursed Pig | 0 | Token, Points | Baby Witch, Mother Witch, Water Into Swine, Book of Curses, Bad Omen, Clipped Wings, The Menagerie |
| Warhero Token | 3 | Action, Points, Warhero Token | Tnack Trav, False Hero, Tylannt, Aura Farming, Aura Gambit, Generational Aura Debt, Grinder Veteran, Heroic Aura Power Play |
| Soul Shard | 0 | Action, Token | Soul Jailor, Soul Slicer, Luckysoul Hoarder, 401J |
| Grubbing Goblin | 0 | Action, Token | Goblin Gang Boss, Nether Portal, War Bonds, CN Backed War Bonds, Loot Attack, The Mob, Uncle Musabi, Call to Chaos |
| Doomsday Button | 0 | Action, Token | Project: Doomsday |
| Skyscraper | 3 | Token, Points | The Conglomerate |
| Permanent: Hand Box | 3 | Token | Save for Later — +1 Action, adds the stored cards to hand |
| Temporary: Hand Box | 3 | Token | Repackage — +1 Action, adds Temporary copies of the stored cards to hand |
| Lunar Fragment | 6 | Action, Lunar Fragment | Book of Moon, Moon Rock, Moon Dance, Astrologist, Journey to the Moon, Supernova, Miracle Fruit, Call to Chaos |
| Book ×12 | 1 | Token, Book | Library Cards, Archivist, Shockwave's Dream, Back to the Raq, Book of Books, Heroic Aura Learning Subscription, Miracle Fruit |
| Egg family ×5 | 0 | Action, Token, Egg, Food | Egg carton cards, Hen, Chicken Coup |
| Grape family ×4 | 1–6 | Action, Food, Token | Grapevine |
| Crumb / Slice of Bread / Gruel / Carat / Matcha / Boba / Milkshake / Brownie / Banana / Huckleberry / Fuit Gummy / Rosemary Triscuit / Slop Bowl / Combo Meal / CN Succulent Xiao | 0–3 | Action, Food, Token | various Food generators |
| Distilled Potato / Distilled Grape / Distilled Gluten | 1–4 | Action, Food, Token, Distilled | discard transforms, House Party, Goatman Family Genetics |

---

## Appendix B — sub-catalogs

### B.1 Miracle catalog (Miracle Fruit — Discover 1 of 3 from this pool)

| # | Miracle |
|---|---|
| 1 | Transform all Copper and Silver into Gold |
| 2 | All Points cards in your deck gain +1 VP |
| 3 | Add 2 Jlore from the Points Shop to your GY |
| 4 | Add +1 Action and +1 Card to all Points cards in your deck |
| 5 | Steal 2 Points cards from opponents into your GY |
| 6 | +13 Money next turn |
| 7 | Add 3 Books to hand, +1 Action |
| 8 | Add 2 Miracle Fruit to your GY |
| 9 | Duplicate all cards in your deck costing (6) or more |
| 10 | Add 2 Diamonds to hand |
| 11 | Add a card costing (10)+ from the Entire Universe to hand, +1 Action |
| 12 | +7 Prophet |
| 13 | Add a (0)-cost Lunar Fragment to the top of 3 random Draft piles |

### B.2 Chaos catalog (Call to Chaos — "???")

Presented in the doc as an unweighted list. **[PROPOSED]:** add a weight column before implementation — entries 1–5 below are near-game-ending and should not share a flat probability with "+3 Prophet".

| # | Effect | Suggested weight |
|---|---|---|
| 1 | All Shops Locked until end of your next turn | Low |
| 2 | Trash a random Draft Shop pile | Low |
| 3 | All players trash 5 random cards from their deck | Low |
| 4 | Transform your hand into random Legendaries | Low |
| 5 | Give all cards currently in decks Flimsy | Very low |
| 6 | Steal 3 cards from an opponent's hand | Medium |
| 7 | Cast 3 Books (random targets) | Medium |
| 8 | Cast Miracle Fruit | Medium |
| 9 | End your turn | Medium (the "downside" roll) |
| 10 | Add 10 Copper to each player's GY | Medium |
| 11 | Add 3 random Entire Universe cards to hand | High |
| 12 | Add a Mythic to the top of your Library *(shown as "an unknown card")* | Low |
| 13 | Add a Diamond to the top of your Library *(shown as "an unknown card")* | Medium |
| 14 | Add a (6)+ cost Entire Universe card to the top of your Library *(shown as "an unknown card")* | Medium |
| 15 | Add a Felinor to the top of your Library *(shown as "an unknown card")* | High |
| 16 | Transform all (3)-or-less cards in your deck into Silver | Medium |
| 17 | Add 3 Cursed Pigs to opponents' decks | Medium |
| 18 | Transform your hand into cards costing (2) more (unchanged where impossible) | Medium |
| 19 | Cast Restart Mission | Low |
| 20 | Trash your GY | Medium |
| 21 | Cast Wardrum's Mystery Box | Low |
| 22 | Add 3 Truss to each player's Library | Medium |
| 23 | −10 Money next turn | Medium |
| 24 | Add a Call to Chaos to an opponent's hand | Medium |
| 25 | Upgrade all Resources in your deck | Low |
| 26 | Add a random Heroic Aura to your field | Medium |
| 27 | Discover another Call to Chaos effect to cast | Medium |
| 28 | +3 Prophet | High |
| 29 | Add a Food to hand for each card in hand | High |
| 30 | All Copper in your deck becomes Grubbing Goblins | Medium |
| 31 | Replace this with a Lunar Fragment | Medium |

**Note on entries 12–15:** these deliberately share the same displayed text ("Add an unknown card to the top of your library"), so the player can't tell a Mythic from a Felinor. That's an S-HIDDEN requirement — display text and actual effect must be decoupled.

### B.3 Craft a Card

Cost is "the highest it can be while still being purchasable" — i.e. 1, 5, or 10 depending on the buyer's Money. Flimsy. Craft a card and add it to your GY.

**First Discover — one of:**
+X Action · +X Money · +X Buys · +X Cards · +X Actions next turn · +X Money next turn · +X Buys next turn · +X Cards next turn

**Second Discover — one of:**
Copy Y cards from an opponent's deck into yours · Transform Y random cards in your deck into ones costing (X) more · Add Y random Entire Universe cards costing (X) or less to hand · Add Y Truss to hand · Add Y Silver to hand · Discard Y cards from an opponent's hand · +Y VP · Lock Y random Draft piles until your next turn

| Price | X | Y |
|---|---|---|
| 1 | 1 | 1 |
| 5 | 3 | 2 |
| 10 | 6 | 3 |

### B.4 In Too Deep — the quest (Celestial Aura, from Quest Accepted!)

One instance at a time. Each floor has a quest and a reward; on completion, descend to one of the offered rooms.

| Floor | Quest | Reward | Leads to |
|---|---|---|---|
| 1 | Buy 2 cards | +2 Money next turn | 2a or 2b |
| 2a | Play 5 cards | Add 1 Truss to the top of your Library | 3a or 3b |
| 2b | Trash 3 cards | Add a Book to hand, +1 Action | 3b or 3c |
| 3a | Draw 20 cards | Shuffle GY into Library, then +4 Cards and +1 Action | 4a or 4b |
| 3b | Buy a card costing (8)+ | Add 1 Gold to the top of your Library | 4b or 4c |
| 3c | Buy a Diamond | Discover a card in an opponent's hand and steal it | 4c or 4d |
| 4a | Draw 20 cards in one turn | Celestial Aura **Undead Army** | 5 |
| 4b | Have 5 Diamonds in your deck | Celestial Aura **Market Manipulation** | 5 |
| 4c | End a turn with (12)+ unspent Money | Celestial Aura **Double Header** | 5 |
| 4d | Have 16 unique cards in your deck | Celestial Aura **Yuya's Mythical Portal** | 5 |
| 5 | Win the game | +20% experience | — |

Flavor: "Rumor goes Paul Hagen's ghost lurks the caves ending the dreams of many adventurers." Floor 5's completion text: "You made it to the bottom! Now how do we get back up…?" — implying a planned ascent branch.

**Implementation:** quest progress must persist across turns and across shuffles, tracking per-turn counters (draw 20 *in one turn* vs cumulative) and deck-state predicates. Reuse the S-PERSIST counter infrastructure.

---

---

## Appendix C — referenced but undefined

Content the design doc names but never specifies. Each needs a designer pass before the relevant cards can ship.

| Referenced as | Where | What's missing |
|---|---|---|
| **Solar Traits** | Doc keylinks (`CREATE_NEW_SOLAR_TRAIT`) | An entire trait system with an authoring template. No traits defined anywhere in the body. |
| **Lunar Traits** | Doc keylinks | Same. Note the Lunar Fragment card family exists in the catalog but is not linked to Lunar Traits. |
| **Cosmic Traits** | Doc keylinks | Same. |
| **Runes** | Doc keylinks (`CREATE NEW RUNE`) | An entire rune system. Only *Runebinder of Jlore* hints at it. |
| **Scripture of Siva** | Prophet Shop | The card body is literally "[to add]". |
| **Vainglorious** | Eastern Metaphysics ("Only for users that are Vainglorious") | An account status. Undefined, and the only card in the game gated on account state — decide whether that's a pattern or a one-off, and whether the card ships without the gate. |
| **The linked spreadsheet** | Doc header | Presumed to hold per-card art, balance numbers, or authoring status. **Get access before estimating** — it may already contain cost and rarity data that supersedes Appendix A. |
| **Prophet card template** | Doc keylinks (`CREATE NEW PROPHET CARD`) | Suggests the Prophet Shop is meant to grow. Relates to open question 14. |

---

## Closing recommendations

1. **Get `Big Action X` and `Recruit` defined before writing any card code.** Twenty-plus cards are unimplementable without them, and both land in the P1 band.
2. **Build the authoring pipeline before building cards.** With ~400 cards, ~40 that mutate their own text and ~25 that need dedicated subsystems, hand-scripting each one will not scale. The structured `stats` block and the effect-node DSL in §10 exist precisely so Buff/Nerf, the MEOW anomaly, the Five Elements anomaly, and localization all work without touching card code.
3. **Cut the P3 set from the first release and say so out loud.** Fusion, the auction, the reality solver, Arc of the Universe, Counting Cards, and A Duel of Wits together carry a disproportionate share of total build cost for ~10 cards. They're good cards. They aren't launch cards.
4. **Nail the three-level card identity model early** (§10.1). Retrofitting instance-level state onto a flat card object after 300 cards exist is the worst version of this project.
5. **Instrument before balancing.** Randomized Anomalies × permanent Buff/Nerf means the balance surface isn't tractable analytically. Ship telemetry with the first playable build, not after it.
