# Solved Blockers

Every `[OPEN]` question in `jlore_jlards_gameplay.md` §14, plus every ambiguity
hit while building, resolved here so the build never stalls on a question.

**Standing rule for this project:** a decided guess costs nothing; an open
question costs one divergent guess per agent. Nothing below waits for a designer.
Each entry names the resolution, the reasoning, and where it lives in code.
Anything marked **REVISIT** is a balance call the sim harness can settle later —
it is decided *now* and merely worth re-measuring.

---

## Blocking questions from §14

### SB-1. `Big Action X` is never defined (11 cards)

**Resolved:** playing the card costs **X Actions instead of 1**. It does not
change anything else about the card.

Reasoning: this is the only reading that makes the payoffs legible. *Vault* is
"Big Action 5, add two Diamonds" — 5 Actions for (10) of Money is a real price.
Read the other way ("grants X Actions") every Big Action card becomes a strict
upgrade over its neighbours, and *Nap* (Big Action 3, +1 Card) becomes nonsense.
It also gives the +Actions archetype (9-5-5, 9-9-6, Energize, Truss) a sink,
which the card pool clearly wants — there are 14 cards that grant 3+ Actions and
almost nothing to spend them on otherwise.

Code: `CardDefinition.bigAction`, `bigActionCost()`, behaviors B72–B73.

### SB-2. `Recruit` is never defined, and is used as both verb and stat

**Resolved:** `Recruit(zone = library, filter, n = 1)` — search the named zone
for up to n cards matching the filter, move them to hand, then shuffle the source
zone. "Recruit X" as a numeric stat means recruit X cards of the player's choice
from the Library.

Reasoning: every use site reads correctly under this definition. *Cookie Guild*
"Recruit an Action costing (3) or less" is a Dominion tutor. *King Varian*
"Recruit the top 3 cards of your Library" is a positional variant (filter by
position, still shuffle after). *All In* "Recruit your deck, then trash it" means
take everything to hand and trash it. The shuffle-after clause is what stops it
from also being deck knowledge, which matters because libraries are hidden even
from their owner (see SB-24).

Code: `{op:'recruit'}`, behavior B42.

### SB-3. End condition conflict — "4 shop piles" vs "40% of Draft Shop piles"

**Resolved:** both, whichever fires first, and both are config. Default
`emptyPileAbsolute = 4`, `emptyPileFraction = 0.40`. With the default 10-pile
Draft Shop the two coincide exactly, which is almost certainly why the source doc
contains both numbers — they were the same rule written twice against a 10-pile
board.

Code: `WinConditionConfig`, `checkEndCondition()`, behavior B14.

### SB-4. Pile sizes are never specified

**Resolved:** by rarity — Common 10, Rare 8, Epic 6, Legendary 4, Mythic 1.
Basic Resource piles get `12 × playerCount`; Basic Points piles get
`8 × playerCount` except Jlore, which gets `4 + 4 × playerCount` because emptying
it ends the game and that should be a real decision, not an accident.
Accelerated/Prolonged scale by 0.6 / 1.4.

**REVISIT** — Jlore pile height is the single biggest lever on match length. The
sim harness reports match length by pile height; tune there.

Code: `pileSizeFor()`, behavior B46.

### SB-5. Does a Prophet purchase consume a Buy?

**Resolved:** **no.** The threshold is the limiter and it is a hard one — you
cannot spend your way past it, only invest across many turns. Charging a Buy on
top would double-gate an economy that already resets nothing, and it would make
the Prophet track strictly worse than the Draft Shop in every turn where you
could afford either.

Code: behavior B59.

### SB-6. Duplicate card name: `Blood Diamond`

**Resolved:** renamed. The (5) Resource/Diamond keeps **Blood Diamond**. The (10)
Action/Diamond becomes **Blood Diamond Cutter** — it trashes cheap Actions to cut
its own cost, so "Cutter" reads as both the gem trade and the mechanic. Ids:
`blood_diamond` and `blood_diamond_cutter`.

Code: behavior B103.

### SB-7. `Mutilate` is defined nowhere

**Resolved:** **Mutilate = trash one half of a Pointer binding while the other
half survives.** Concretely: `Mutilate(instance)` trashes the instance and
removes the pointer binding from its partner without trashing the partner.

Reasoning: it appears only inside Pointer's own text — "they are
Played/Mutilated/Trashed together" — which lists three verbs where Played and
Trashed are already defined. The pattern is a rising triple: play together, break
together, die together. Mutilate is the middle rung, the one that severs the
binding. Defining it as anything else (a damage system, a counter) requires a
subsystem the game does not otherwise have.

Practical consequence: Pointer is fully implementable. When either bound card is
trashed by anything, its partner is Mutilated — trashed too, binding cleared.

Code: `NextCardMod.bind = 'pointer'`.

### SB-8. `Unfathomable` is defined nowhere

**Resolved:** an Unfathomable card is **excluded from every Discover pool, random
pull, copy effect, steal effect, and transform target**. It can be acquired only
by its printed purchase route.

Reasoning: it appears only on *Prophesized Jlore*, whose own rider is "If
obtained through any other means, TRASH THIS." The keyword and the rider are the
same intent stated twice — the rider is the failsafe for routes the keyword
misses. Implementing the keyword as a pool exclusion means the rider almost never
has to fire, which is the correct relationship between a rule and its failsafe.

Code: `Keyword 'Unfathomable'`, `CardDefinition.excludeFromPools`, behavior B33.

### SB-9. Variant parameters `X` for Countdown, Duel, Crown

**Resolved:** Countdown `X = 12 × playerCount` turns. Duel `X = 15` VP lead.
Crown `X = 30` VP.

Reasoning: calibrated against the anomaly versions of the same conditions, which
*are* specified. Death's Door ends at `10 × playerCount` and reads as the short
variant, so the deliberate Countdown variant should run longer — 12. Heavy is the
Crown leads by 10 and Aim for the Moon targets 20; both are anomaly-grade swingy,
so the chosen variants sit above them at 15 and 30.

**REVISIT** — all three are `winCondition.x` and the sim harness reports match
length per variant.

Code: `WinConditionConfig.x`, behavior B91.

### SB-10. Draft Shop size and source

**Resolved:** **10 piles**, distinct, drawn from all purchasable non-Basic cards
with rarity pull weighting. Not scaled by player count.

Reasoning: 10 is Dominion's number and the whole card pool is designed against
Dominion's shape. Scaling with player count (the doc floats `5 × playerCount`)
makes a 4-player board 20 piles, which dilutes every "if you have the largest
deck" and every pile-empty end condition past recognition. Keep the board fixed
and let player count change the pressure on it, which is the more interesting
axis.

Code: `MatchConfig.draftPileCount`, behavior B45.

---

## Design-level questions from §14

### SB-11. Can multiple Anomalies roll at once?

**Resolved:** **one per match.** Anomalies carry mutex-group tags
(`startingDeck`, `endCondition`, `startingAura`, `stat`, `shop`) so the roller
could support combinations later, but the roll takes exactly one.

Reasoning: the doc's own probability table treats Anomalous and Chaotic as
separate outcomes, and Chaotic is Anomaly + Formation, not Anomaly + Anomaly. So
the source never actually asks for two anomalies. One is also the only version
that can be described to a player in one line, which matters for a modifier that
warps the whole match.

Code: `rollAnomaly()`, behavior B82.

### SB-12. Can a player hold multiple Celestial Auras?

**Resolved:** **unlimited Celestial, one Heroic, one Hypercelestial.**

Reasoning: Heroic is explicitly capped at one and has an activation economy (2
Money, once per turn) that only makes sense as a scarce slot. Celestials are
passive and several sources grant them repeatedly — *Conjure Aura* is a (12)-cost
card whose entire text is "Manifest a Celestial Aura," which is a terrible card
if the second one overwrites the first. Hypercelestial is capped at one because
both of them (Lotus Solutions, Shooting Star) are match-defining and stack into
absurdity.

Code: behaviors B76, B78, B79.

### SB-13. Fusion arithmetic

**Resolved:**

| Property | Rule |
|---|---|
| Cost | **sum** of components, capped at 20 |
| Rarity | **max** of components |
| Types | union |
| Subtypes | union |
| Tags | union |
| Keywords | union, except: Flimsy is dropped if any component lacks it; Indestructible survives if any component has it |
| Stats | sum, per stat |
| Effects | concatenated in component order |
| Name | `"<A> · <B>"` |
| Art | composite treatment, `art.key = "fused"` |

Sum for cost, not max, because fusion is meant to be a payoff — *What is Love?*
costs (9) and fuses twice, and the fused cards go to hand where cost only matters
for later cost-reading effects. Max for rarity because a Mythic fused with a
Common must not become pullable from a Common pool.

Code: behaviors under S-FUSE; `CardInstance.fusedFrom`.

### SB-14. Is the whole Prophet Shop present every match?

**Resolved:** **all 24, every match.** They are threshold-gated, not
supply-gated: a player who never invests in Prophet cannot touch any of them, and
a player who commits hard has earned the whole menu. Sampling the Prophet Shop
would make the entire Prophet archetype a gamble on whether its payoff showed up,
which is the one thing a slow investment track cannot survive.

Code: behavior B98.

### SB-15. Tiebreaker when VP is level

**Resolved:** fewest turns taken → smallest deck → shared win.

Reasoning: fewest turns rewards the player who got there first, which is the
standard deck-builder convention and reads as fair at the table. Smallest deck
breaks the remaining ties toward the tighter build, consistent with a game whose
whole scoring layer rewards deck sculpting. A genuine three-way exact tie is a
shared win, because inventing a fourth tiebreaker to avoid it is worse than the
tie.

Code: `finalScores()`, behavior B16.

### SB-16. `Indestructible` + `Flimsy`

**Resolved:** **Indestructible wins; the card goes to GY** when played.

Reasoning: Indestructible is printed on exactly three cards (Series E/F/X
Funding) and is their entire defensive value — they are negative-VP liabilities
you take on for money, and being unable to remove them is the drawback. Flimsy
losing that fight would let a single Corrosion undo the card's whole design.
"Cannot be trashed" is also the more absolute wording of the two.

Code: behavior B12.

### SB-17. Does Buff/Nerf on a 0 stat add the stat line?

**Resolved:** **yes, it adds it.** Universal Buff! can give a Resource +1 Action.

Reasoning: Buff's text is "pick a random base stat and +1 it," and the base stat
set is fixed at five. Restricting it to already-printed stats would make Buff's
value depend on how many stat lines a card happens to print, so buffing a Copper
(one stat) would be near-guaranteed +Money while buffing Ultimate Infestation
(four stats) would be a coinflip between four good outcomes. Uniform over five
stats always is both simpler and the reading that makes *Indirect Buffalo* and
*Performance Enhancing Cookie* interesting.

Code: `BUFFABLE_STATS`, behaviors B69–B70.

### SB-18. Known Universe punishes new players

**Resolved:** **seed every codex with all Basic + Common + Rare cards**
(`MatchConfig.seedCodexWithCommons`, default true). Epic, Legendary and Mythic
accumulate through play.

Reasoning: a Known Universe Discover should never be worse than a coinflip, and
with Common+Rare seeded it never is — those two tiers are 75% of the pool. The
progression fantasy survives intact because the *exciting* pulls are exactly the
three tiers that still have to be earned. Leaving it unseeded makes a veteran's
*Epic Fate* a build-around and a new player's *Epic Fate* a blank, at the same
table, which is a trap and not a feature.

Code: `knownUniverse()`, behaviors B93–B94.

---

## Card-specific gaps from §14

### SB-19. `Scripture of Siva` — body is "[to add]"

**Resolved:** written. **"Play on Buy, Flimsy. Discover a card from any
opponent's Library and add a copy to your hand. Repeat for each other
opponent."**

Reasoning: the other four Scriptures each own one axis at (10) Prophet / −5
drain — Kwzki owns cost reduction, Jayaad owns library destruction, Space owns
auras, and Siva is the gap. The unclaimed axis at that power level is
cross-player library access, which the game supports (Spyglass, Thought Steal,
Griftah) but only at Rare. A Legendary Scripture that hits *every* opponent's
library is the correct top of that curve, and it scales with player count the way
Jayaad's "trash all Libraries" does.

Code: `scripture_of_siva`.

### SB-20. `Call to Chaos` — 30+ unweighted effects

**Resolved:** Appendix B.2's suggested weights adopted as literal numbers:
**Very low = 1, Low = 2, Medium = 5, High = 9**. Total weight 148. So a
near-game-ending roll (entries 1–5) lands about 6% of the time and the three High
entries carry about 18%.

Code: `{op:'random', branches}` in `call_to_chaos`, behavior B35.

### SB-21. `Counting Cards` — needs a blackjack sub-spec

**Resolved:** ship it as scripted, not interactive. **Reveal cards from the top
of your Library one at a time, adding their cost; (1)-cost cards count as 11 or 1,
whichever keeps the total ≤ 21. Stop automatically at 17+ (dealer rule). If the
total is ≤ 21, play every revealed card; if it busts, discard them all.**

Reasoning: the interactive version needs a hit/stand prompt loop, a soft/hard ace
UI, and a time limit, for one card. The dealer's own stand-on-17 rule is the
standard, well-understood automation of exactly that decision, so the card keeps
its identity and its risk curve while costing one scripted effect. Listed under
Out of scope in SPEC.md as "no real blackjack sub-game."

Code: `counting_cards`.

### SB-22. `A Duel of Wits` — hostile math prompt

**Resolved:** replaced with a **deck-statistics multiple choice**: the card asks
one true/false question about the player's own deck drawn from a fixed set
("your deck's average cost is above 3", "you have more Actions than Resources"),
with a 15-second default. Correct → +4 Cards. Wrong or timeout → nothing.

Reasoning: the intent of the card is "know your own deck," and a randomized
logarithmic inequality tests arithmetic patience instead. The question set keeps
the intent, is answerable in the time a turn allows, and is legible on a card.

Code: `a_duel_of_wits`.

### SB-23. `Arc of the Universe` — 3-D gravitational sim for +999 VP

**Resolved:** **cut the sim, keep the card.** Resolves as: +1 Action, then a
weighted roll — 1% +999 VP, 9% +25 VP, 90% +3 VP.

And yes, **+999 VP is a genuine win button** — that is what a Mythic costing (3)
is for, and the 1% is the price. The odds are what make it a story rather than a
strategy.

Reasoning: a persistent 3-D alignment minigame with its own visualization is,
by the source doc's own estimate, one of the most expensive items in the build,
for one card. The roll preserves the card's entire table presence (someone
occasionally wins out of nowhere) at 1% of the cost. Listed under Out of scope.

Code: `arc_of_the_universe`.

### SB-24. `The Past` / `The Future` / `The Eternal Show` — paradox loop

**Resolved:** an explicit resolution rule for all three.

- **The Past** copies the last card *fully resolved* this turn. If none, it does nothing.
- **The Future** registers a `NextCardMod`: the next card played this turn is resolved, and then The Future resolves as a copy of it. If the turn ends first, The Future does nothing.
- A card may not be copied by a copy-effect it is itself resolving inside (cycle detection on `sourceIid`).
- **The Eternal Show** checks for exactly the configuration its text describes: a resolving The Past whose copy target is a The Future whose copy target is this Eternal Show. When that holds, the loop is broken *and* the payoff fires (trash the opponent's deck). It is the only card that reads the cycle detector.

Reasoning: the loop is deliberate flavor, so the rule should make it *reachable*
and *terminal* rather than illegal. Cycle detection turns the paradox into a
detectable event, and The Eternal Show is the card that pays out for causing it.

Code: `QueuedEffect.depth`, behaviors B38 and B43.

### SB-25. `Too Many Stats` — reroll range and mid-turn cost shifts

**Resolved:** cost rerolls in **[2, 10] inclusive** at the start of each turn.
All six stats reroll in **[−3, 3]**. Big Action, Combo and Recruit values reroll
in **[1, 3]**. A card in hand keeps whatever values it had when the turn started —
**rerolls happen only at start of turn, never mid-turn** — so a cost cannot shift
between deciding to play it and playing it.

Reasoning: the doc writes the range as `(2,10]` which excludes 2; that is almost
certainly notation drift, since every other cost band in the game is inclusive.
The mid-turn freeze is the only version that isn't actively unfair.

Code: `too_many_stats`.

### SB-26. `Craft a Card` — three cards sharing a name and a dynamic price

**Confirmed as written, implemented as one card.** A single definition
`craft_a_card` whose cost resolves at purchase time to the **highest of 1, 5, 10
the buyer can currently afford**. X and Y scale 1/1, 3/2, 6/3 by the price
actually paid.

Reasoning: three definitions differing only by price would appear as three
separate Draft Shop piles and triple the card's presence in every random pool.
One card with a purchase-time cost resolution is the same experience with a
tenth of the surface. The "highest you can afford" rule is confirmed — it makes
the card a money sink that always empties your wallet, which is clearly the joke.

Code: `craft_a_card`, Appendix B.3 menus.

### SB-27. `Lead` — infinite money engine at cost (−2)

**Resolved:** floor confirmed at **(−2)**, but the pile is **locked for the rest
of the turn after one purchase**. Buying Lead at −2 pays you 2 and locks the
pile; you cannot loop it.

Reasoning: the card's payout ("gain Money equal to its current price") is the
whole point and shouldn't be nerfed, but "with enough Buys it's infinite" is a
real break, not a spicy edge case. The self-lock is already an established
pattern in this game — every Series Funding card does exactly this, and for
exactly this reason (they also have negative costs). Reusing that pattern costs
nothing and keeps Lead's identity.

Code: `lead`, `{op:'lockPile'}` on buy.

### SB-28. `Prophesized Jlore` (+100 VP) vs `Aim for the Moon` (ends at 20 VP)

**Resolved:** **Prophesized Jlore is excluded from matches whose win condition is
a VP threshold** — Aim for the Moon, Heavy is the Crown, and the Crown and Duel
variants. In those matches the card is removed from the Prophet Shop and every
pool.

Reasoning: 30 banked Prophet is a whole-game investment, and it should pay out.
20-VP-to-win is a whole-game sprint, and it should be winnable by sprinting.
Putting them in the same match means the Prophet player wins on the turn they hit
threshold regardless of anything else, which deletes the variant rather than
interacting with it. Removing one card is a much smaller loss than removing a
win condition.

Code: `applyAnomalySetup()` pool exclusion.

### SB-29. `Mercenary 280` — +280 VP if deck costs sum to exactly 280

**Confirmed: it is a joke, and it stays.** It is also genuinely achievable —
`sumOfDeckCosts` is a number the player can steer with trashing and refining, and
a player who deliberately builds to exactly 280 has earned an absurd payout.

It does interact with Crown and Duel, so it takes the same treatment as SB-28:
excluded from VP-threshold variants. In Standard and Countdown it stays live.

Code: `mercenary_280`.

### SB-30. Content typos

**Fixed at authoring time:** "Flismy" → `Flimsy` (×4, the Egg cartons),
"acquistioning" → "acquisitioning", "Chicken Coup" → **Chicken Coop**,
"Fuit Gummy" → **Fruit Gummy**. Ids follow the corrected spellings
(`chicken_coop`, `fruit_gummy`).

---

## Blockers hit during the build, not in §14

### SB-31. `reduce(state, action, rng)` vs `reduce(state, action)`

`ARCHITECTURE.md` §4 freezes a three-argument `reduce` with an injected `rng`.
**Changed to two arguments**, with the rng cursor living in `GameState`.

Reasoning: an injected stateful rng makes `reduce` pure only if the caller
recreates the rng at exactly the right cursor for every replay, which pushes the
determinism guarantee out of the engine and into every call site — including the
host loop, the sim harness, and every test. Moving `rngCursor` into state makes
`reduce` pure in the strong sense the architecture doc actually wanted: the same
`(state, action)` always yields the same result, full stop, with nothing to
remember on the outside. The upgrade path the doc cares about (move `reduce` into
a serverless function) gets *easier*, because the whole rng state serializes with
the game state.

### SB-32. Instances stored centrally vs inline in zones

`ARCHITECTURE.md` §4.2 says "cards in zones are instances, not IDs." **Changed
to a central `state.instances` registry with zones holding ordered id arrays.**

Reasoning: instance identity has to survive moves between zones, and every
counter-reading card (Plague, Lection, Relics, Tixatus) reads an instance the
effect did not select. With inline objects, a move is a delete-and-reinsert and
every held reference goes stale; with a registry, a move rewrites one array and
one `zone` field. The three-level identity model the doc insists on is preserved
exactly — this only changes where the object lives, not what it is.

### SB-33. Cards as JSON vs typed TS modules

`ARCHITECTURE.md` §11 specifies card definitions as static JSON. **Changed to
TypeScript modules exporting `CardDefinition[]`**, with `npm run cards:export`
emitting JSON for tooling and art pipelines.

Reasoning: with ~400 cards and a 60-op effect DSL, a typo in a JSON effect node
is found at runtime, by a player, mid-match. In a typed module it is found by
`tsc`. The doc's actual requirement — "add cards by adding a file, no engine
changes" — is fully preserved. JSON remains available as an export for anything
outside the type system.

### SB-34. Hidden libraries — even from their owner

The view filter sends library **counts only**, including the viewer's own
library. Confirmed as intended: the doc's own note is "not even your own —
otherwise the whole draw mechanic is pointless."

Consequence for cards: every effect that reads the Library (Destiny Draw, Depot
Draw, Sticky Fungers, Recruit) resolves server-side in the engine and returns
only its result to the view. Recruit's shuffle-after clause exists precisely so a
tutor does not leak library order.

### SB-35. `Play on Draw` recursion

A Play-on-Draw card that draws (Soul Shard chains, Quick Patch, Midas Touch) can
cascade. **Resolved:** Play-on-Draw resolution is capped by the same
`config.recursionDepth` as everything else, and a card may not trigger its own
Play-on-Draw within one resolution chain.

### SB-36. Anomaly `Time Flail` is not a rules change

"Turns are 2.5× as fast" is a **turn-timer modifier only** — `MatchConfig.turnSeconds
/ 2.5`. It touches no rule and no engine behavior. The engine records it; the
client enforces it.

### SB-37. What happens when the Library and GY are both empty and a card says draw

**Resolved:** draw as many as possible, then stop. No penalty, no fizzle of the
rest of the card. Behavior B29.

### SB-38. Negative VP and the running total

VP can go negative on a player (Ancient Curse, the Series Funding cards, Rotten
Egg). **No floor.** Money also has no floor (Loan Shark, Outstanding Debt), but
**Prophet is clamped at 0** with exactly one exception (SB-5 / The Unconcerned
Lion). Behavior B60.

### SB-39. `Eastern Metaphysics` is gated on an account status that does not exist

`Vainglorious` is named on one card and defined nowhere, and there is no account
system in this build. **Resolved:** ship the card with the gate removed. The
three-aura tracking mechanic is self-contained and works fine ungated.

### SB-40. Draft Shop must not roll cards whose subsystems were cut

Cards that depend on cut subsystems (the auction, the reality solver) still exist
as definitions but resolve through their documented cheap substitutes rather than
being removed, so the catalog stays complete:

| Card | Substitute |
|---|---|
| Zephrys | Heuristic scorer over the current hand and board — no solver |
| Second Time Around | Discover 3 from the player's Known Universe, ranked by the same scorer |
| Infinite Realities | Generate a curated high-synergy deck from the player's Known Universe |
| Glubby Gloob the Auctioneer | Bots and absent players bid via a fixed heuristic; resolves at start of next turn |

The scorer weights: money needed to reach the next affordable pile, Actions
remaining, VP gap to the leader, and Library height. Deterministic, seeded,
sub-millisecond.
