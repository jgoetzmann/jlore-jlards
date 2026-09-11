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

**Resolved:** **four piles, sampled per match**, spread across the threshold
range. `MatchConfig.prophetPileCount` sets the number; the shop builder defaults
it to 4, the way `draftPileCount` defaults to 10.

**This supersedes the original ruling, which was "all 24, every match."** That
argument is not wrong and is worth keeping: Prophet cards are threshold-gated,
not supply-gated, so a player who never invests cannot touch any of them and a
player who commits hard has earned the whole menu. Sampling makes the Prophet
archetype partly a gamble on whether its payoff showed up, and that is the one
thing a slow investment track is least able to absorb. **That cost is real and
we are paying it knowingly** — a player who banks Prophet for ten turns toward a
Scripture can now open a board that has no Scripture on it.

Why it is still the better trade:

- **23 piles is not a menu, it is a wall.** The Prophet column was longer than
  the other three shops put together, and the board grew to fit it — the direct
  cause of the unresolved layout blocker in SB-63. A shop nobody can read is not
  offering a choice either.
- **A fixed shop has no board variety.** Every match opened on the same Prophet
  column, so the Prophet track played out identically every time. The Draft Shop
  has been sampled since SB-10 for exactly this reason; the Prophet Shop was the
  odd one out.
- **The gamble is bounded by the stratification, not by luck.** The sample is
  not uniform. The candidates are sorted by threshold, cut into four contiguous
  bands, and one card is taken from each, so *every* board offers a cheap
  on-ramp (threshold 2 or less), two middle rungs, and one long-term target
  (threshold 8 or more). You can always start investing on turn one and you
  always have something to save for. What varies is *which* payoff, not
  *whether* there is one — which is a read-the-board decision rather than a coin
  flip.
- **Within a band the pick is uniform, not rarity-weighted**, unlike the Draft
  Shop. The Draft Shop pulls from ~500 cards where rarity is the only thing
  keeping commons common. The Prophet list is 23 hand-placed cards where the
  threshold already *is* the scarcity gate (B57), so weighting by rarity on top
  double-counts it — Mulligan (common) would land in half of all matches while a
  Scripture (legendary) essentially never would, which is the flat board this
  change exists to avoid.

The sample is drawn from the same seeded rng as the Draft Shop, so it replays
exactly like everything else, and SB-28's VP-threshold exclusion is applied to
the candidate pool before sampling rather than to the result.

**REVISIT** — if playtests show the Prophet track feels like a lottery, the knob
is `prophetPileCount`, not the sampler: 6 keeps the variety and roughly halves
the odds of missing a given archetype.

Code: `MatchConfig.prophetPileCount` (carried through `normalizeConfig`, so a
count handed to `createMatch` reaches the shop builder), `prophetCandidates()`,
`sampleProphetDefs()`. B98 still counts 23 in the *catalog*; how many of them
reach a table is `test/shop-prophet-sample.test.ts`.

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

### SB-41. Does a clock-triggered end condition get the lap of honour?

**Resolved: no.** `countdown`, Death's Door, the Doomsday Counter, and any
`hardEndTurn` finish the game **immediately**. Only a player-triggered end — a
pile emptying — gets the B15 lap of honour.

Reasoning: the lap exists so that when a *player* ends the game, everyone still
gets equal turns. A clock-triggered end is already equal by construction, so
extending it does nothing for fairness and instead makes `winCondition.x` mean
`x + playerCount` — a Countdown match configured for 12 turns was ending on turn
14 with 2 players. A turn limit that isn't the turn limit is worse than either
rule applied consistently.

Death's Door already read this way in the source doc ("the game ends at the end
of turn `10 × playerCount`", no lap mentioned), so this makes the deliberate
Countdown variant agree with its own anomaly counterpart.

VP-threshold ends (`duel`, `crown`, Aim for the Moon, Heavy is the Crown) **keep
the lap**, because those are player-triggered: one player crossing a threshold
should not deny the others their turn in the round.

Code: `noteEndCondition()` in `src/engine/core/endgame.ts`.

### SB-42. A prompt that leads to another prompt could loop forever

**Resolved:** a per-turn ceiling of **60 prompt resolutions per player**. Past it
the chain is fizzled: `pending` is cleared, the queue is dropped, and a
`promptFizzle` entry is logged.

Reasoning: `config.effectNodeBudget` counts nodes *within one resolution*, and
every resume starts a fresh one — so the depth cap and the node budget, which
between them cover every other recursion path in the game, cover this one not at
all. A card whose prompt branch raises another prompt can therefore loop
indefinitely. This was found the hard way: wiring `{op:'choose'}` to actually
resolve its branch sent the sim harness from 155 seconds to over 600 with no
termination.

60 is deliberately generous — a Discover-heavy turn spends fewer than a dozen —
so the ceiling only bites on a genuine cycle.

Code: `PROMPT_BUDGET_PER_TURN` in `src/engine/core/resume.ts`.

### SB-43. `{op:'choose'}` resolved to nothing

**Resolved:** `opChoose` now writes the per-option effect lists onto the prompt's
`ctx.optionEffects`, keyed by option index, which is where the resume path looks
for them.

This was a silent gap, not a reported one: the prompt appeared, the player picked
an option, and the branch never ran. About **17 "choose one" clauses across a
dozen cards** — Archivist, Jalshi, Night on the Town, Plandemic, Throttle
Markets, The Curator, Recession Indicator, Nine Lives Loan, Lord of the Cave,
Plague Charger, Spider E.B., Cup Runneth Over — printed a choice they did not
make, while still paying out their stat lines, so nothing looked broken.

It survived the whole build because no numbered behavior covered it and the two
rival resume implementations hid it: `core/resume.ts` probed for an export name
`@engine/effects` never had, so its own local path always won, and the local path
read a field the choose op never wrote.

Covered now by `test/effects-choose.test.ts`, which fails without the fix.

Code: `opChoose` in `src/engine/effects/ops/choices.ts`.

---

## From the catalog audit

A pass comparing all 533 cards against Appendix A/B found 263 verified defects.
The entries below are the decisions that came out of it. The pattern running
through nearly all of them is the one SB-42 and SB-43 already named: **the
dangerous defect here is not the one that crashes, it is the one that quietly
does half the work.** Every item below was live in a green suite.

### SB-44. Twelve cards were defined twice, and the uniqueness checks could not fail

**Resolved:** one definition per card; the duplicate deleted. `archetypes/books.ts`
went entirely, since all six of its cards were duplicates of the `tribes/books.ts`
versions carrying a spurious `Scripture` subtype — which would have put Library
Card into Lection's "add a random Scripture" pool.

The registry is keyed by id and `cardOrder` only records an id the first time it
is seen, so a second definition silently replaced the first and `allCards()`
returned a deduplicated list. Both the validator and B95/B103 asked *that* list
for duplicates, so the check could never fire. Whichever module imported last
won: Constellation scored "+1 VP per 2 unique cards" instead of its printed
trash-a-cost-run clause, and Miracle Fruit was a (3) token instead of the (10)
Legendary.

Four of the twelve came from A.27/A.28 rows that read "*(see A.10)*" — cross
references, which a builder implemented as second cards, inventing new effects.

Code: uniqueness now runs on `allCardDefinitions()` in both `validate-cards.ts`
and `catalog-integrity.test.ts`.

### SB-45. Milkshake: A.7 prices it, A.29 calls it a token

**Resolved:** the A.7 row wins — a purchasable (4) Rare, `Token` dropped from its
types. A.7 is the specific row and states a rarity and a price; A.29's grouped
row covers "0–3" and names no rarity. Decisively, no Food generator in the
catalog mints a Milkshake, so as a token it would be unobtainable. The doc shows
the same looseness on Jmart Banana Bunch, also a priced Rare.

### SB-46. One table, three copies: anomaly rate and node budget

**Resolved:** `anomalyChance` is **0.30** everywhere and `effectNodeBudget` is
**200** everywhere.

`defaultMatchConfig`, `DEFAULT_SIM_CONFIG` and the UI's `defaultConfig` are three
hand-maintained copies of the same table, and they had drifted: anomalies rolled
at 25% in the engine, 25% in the sim and **15%** in the actual game, against
§8.1's 30% (20% Anomalous + 10% Chaotic, Formations cut). The node budget was
200 / 500 / **2000**. So the shipped game rolled anomalies at half the documented
rate and ran a cap ten times looser than the sim measured balance against.

Measured before changing the budget: over 15 matches, budget 200 and budget 2000
produce identical results — the cap only ever catches the paradox loops it exists
for. **REVISIT:** the three tables should be derived from one.

### SB-47. No aura trigger was ever dispatched

**Resolved:** `fireOwnedTriggers` now sweeps the player's Field, and the
instance-only windows (`onBuy`, `onGain`, `onPlay`) call `fireFieldTriggers`
alongside their instance dispatch. `startOfTurn` is excluded, because
`auraStartOfTurn` already owns that window (B80).

`fireOwnedTriggers` built its candidate list as `[...play, ...hand, ...gy,
...library]` while its own doc comment claimed it covered "the aura triggers on
that player's field". It did not, and nothing else did either — `p.field` was
read only to reset `usedThisTurn` and tick countdowns. Every Celestial aura is a
trigger, so the entire tier was inert, along with the five Anomalies whose whole
effect is to grant one.

Widening the card dispatch instead would have been wrong: sweeping every owned
card on `onBuy` fires riders like Lead's pile lock from a player's graveyard.

### SB-48. A prompt's `then` never saw the player's choice

**Resolved:** `localResume` now substitutes the chosen card into the `then` and
runs it once per choice, mirroring `pushChosen` / `runThenPerInstance`.

`core/resume.ts` probes for a `resumePrompt` export that `@engine/effects` does
not have — the same shape as SB-43 — so every prompt in the game resolved
through the local fallback, which ran `prompt.then` raw. `substituteDefId` was
never called, so `'$discovered'` never resolved, and `{self:true}` inside a
`then` bound to the card that *asked* rather than the card that was *picked*.
Of 42 Discovers in the catalog, 37 had a custom `then` and only 5 used the pick:
the rest either re-rolled the pool for a fresh random card or operated on
themselves. The player chose, and the choice was discarded.

A per-choice `then` is also skipped entirely when nothing is picked — otherwise
declining a `min:0` selection ran the body against the source card, and Antibody
Extraction trashed itself.

### SB-49. Suspended prompt nodes were dropped

**Resolved:** `resumeNode` re-runs the node a prompt suspended on, with the
answer as `pre`.

`runQueue` shifts an item off the queue before resolving it and, on `suspend`,
parks only what was left — the suspended node itself was gone. Discover, choose
and selectCards survive that because they carry their continuation in
`prompt.then`, but a `pick:'choose'` selector inside `discard` / `trash` /
`moveTo`, and every pile prompt, expect to be re-entered. `resolveTargets` and
`resolvePiles` were already written for it, both returning `pre.iids` /
`pre.pileIds` when handed one. Nothing ever handed them one, so those cards
prompted the player and then did nothing.

### SB-50. `moveTo` had no destination owner, so no steal moved anything

**Resolved:** `{op:'moveTo'}` takes an optional `who`, the owner the card ends up
with. Omitted, the card keeps its current owner — right for moving between your
own zones, and the reason every steal written as a bare `moveTo` handed the card
straight back to the player it was taken from.

### SB-51. `aside` conflates scratch space with storage

**Resolved:** `CardFilter` gained a `counter` axis, and the Hand Boxes select
`counter:{key:'boxed',gte:1}` rather than "everything in aside that is not a
Token".

`aside` is one staging pile per player. A dozen cards park instances there for
the length of a single effect, which is safe on its own, but Save for Later and
Repackage store a hand there across turns. Without a way to tell the two apart,
opening a Hand Box scooped up whatever another card was mid-way through staging.

### SB-52. An unregistered `count()` filter name reads as 0

**Resolved:** the five real filters card text names — `oneCost`, `cost7`,
`diamond`, `soul_shard`, `kwzki_cultist` — are registered in `NAMED_FILTERS`,
and `cards:validate` now fails on any name that is not.

`count(x)` resolves x through `NAMED_FILTERS` and an unknown name evaluates to 0
rather than raising. Eleven names were in use and one was registered, so Star
Aligner, Treasure Vault, Snowball, Kwzki Cultist and Soulcologist Mike Kwzka all
scored or paid exactly nothing, in a green suite. Six names describe computed
values that are not filters at all (`longestCostRun`, `topCost`, `myCost`,
`totalVp`, `bestOpponentCost`, `tallest`) and were rewritten card-side.

### SB-53. Tnack Trav was unbuyable in every match

**Resolved:** `PROPHET_SHOP_CARD_IDS` named `tnack_trav`; the definition is
`tnack_trav_prophesized_savior`. `buildShop` resolves that list through
`safeGetCard`, which swallows the registry's throw and `continue`s, so the pile
was simply never created and a Legendary sat out every game. The validator now
checks the list against the registry. Counting `shop === 'prophet'` definitions
could not catch it: the definition was fine, the id list was wrong.

---

## From the deferred-card pass

The audit fixed what card data could express and left ~110 cards whose printed
behaviour the engine had no way to say. This pass built those capabilities and
finished the cards. The decisions worth recording:

### SB-54. A Selector's `count` is a table total, not a quota each

**Resolved:** `Selector.perPlayer` applies `count` and `pick` once per resolved
player. The default stays a total, because "trash 2 cards from the table" is
also a real clause — but "each opponent discards 2" needs the other reading and
was silently taking 2 between them. `{op:'recruit'}` was already per-player,
which is why some cards had been contorted into using it as a discard.

### SB-55. `self` is not "the current player"

**Resolved:** `Who` gained `activePlayer`, `nextPlayer` and `owner`.

Inside a trigger the effect frame belongs to the instance's OWNER, so `self`
resolves to whoever owns the card, not to whoever is taking the turn. Recurring
Felinor prints "it goes to the current player's GY instead" and there was no way
to name that player. `owner` is its mirror, for a trigger that must pay the
card's owner rather than the actor.

### SB-56. Prices that are a reading of the board

**Resolved:** `src/engine/shop/dynamic.ts` — a small table of definitions whose
price is a pure function of state, consulted by `costOf` before the modifier
stack. Pure of Heart ("costs (0) if your hand is empty"), Giant's Aid ("(1) less
per card played this turn"), Lead's per-turn reroll and Craft a Card's
"highest price you can still afford" all live there.

Every previous attempt at these was a trigger declared on the shop-pile
instance, and no dispatcher fires triggers on a card sitting in a pile — so all
four were dead. A start-of-turn snapshot could not work either: Pure of Heart's
condition is sampled at the one moment in the turn cycle when the hand is
guaranteed full.

**REVISIT** if a card ever needs a price that depends on a choice the buyer has
not made yet. Blood Diamond Cutter is that shape — it discounts itself by
trashing cards as part of the purchase — and is deliberately not in the table.

### SB-57. Per-turn state that belongs to the seat, not to a card

**Resolved:** `{op:'addCounter', scope:'player'}` writes `PlayerState.counters`,
and a key prefixed `turn:` is cleared in `resetTurnStats`. Expressions read the
key by name with the prefix stripped.

An instance counter cannot express "one Ricochet per turn": a *second* Ricochet
is a different instance and would not see the first one's mark. Trashing also
stamps `turn:trashed` and `turn:trashed<Subtype>` on the player doing the
trashing — not the card's owner, because "if you trashed a Felinor this turn" is
about your action and taking an opponent's Felinor has to count for you.

### SB-58. Locks and cost mods disagreed about what `expiresOnTurn` means

**Resolved:** a lock's `expiresOnTurn` is the first turn it is already GONE
(`lockIsActive` tests `turn < expiresOnTurn`); a CostMod's is the LAST turn it
still bites. One helper was serving both, so it was right for cost mods and one
turn short for locks — which made **every `duration:'turn'` lock in the catalog
inert the instant it was applied.** `expiryTurnFor` and `costModExpiryFor` now
each serve their own convention and the shared helper is deprecated.

### SB-59. Fusion

**Resolved:** `{op:'fuse'}`, wiring up the `fusedDefinition` builder that had
been written, tested against SB-13's arithmetic, and never called. The first
component becomes the composite in place — so Matchmaker can fuse cards inside a
Library — and the rest are consumed.

Each component gets an `onFuse` trigger **resolved inline, before the merge is
committed**. That is Chopped Chuzz's "when this attempts to Fuse, trash it
instead": enqueuing the trigger instead would have run the refusal after the
composite already existed, and if the refuser happened to be the first component
it would have destroyed the finished card rather than excusing itself.

### SB-60. A modifier that waits for the card it names

**Resolved:** `NextCardMod.filter`. A modifier that names a filter is neither
applied to nor consumed by a card that does not match, so "the next Resource you
play" stops meaning "the next card you play, if it happens to be a Resource".

### SB-61. What a purchase actually cost

**Resolved:** the price paid is stamped on the bought instance as
`counters.pricePaid` (read as `selfPricePaid`) and passed into the `onBuy`
trigger frame as `paid`.

A rider watching your purchases had no way to learn the price: the bought card
has already left the shop by the time the event fires, so `selfCost` reads its
printed cost, and the trigger's own source instance is the rider rather than the
purchase. Rebate's "refunds 60% of its cost" and Professor of Curvature's "that
purchase is free" both depend on it.

### SB-62. The clauses the DSL could not say, and what each one cost to say

This section started life as a list of clauses that shipped absent rather than
approximated. Every one of them is now implemented; the table is kept because
the *shape* of the list is the finding. A clause is unwriteable when the engine
has no hook at the moment the sentence describes — not when the sentence is
complicated. Each row below is one hook, and most were a few lines.

| Clause | The hook it was missing | Where it lives now |
|---|---|---|
| Safety Net / The Fall Guy — redirect a trash | A pre-move "would be trashed" window carrying the subject. `onTrash` fires after the card is already in the trash. | `offerTrashWindow` + the `onWouldTrash` event (`core/triggers.ts`); the subject wears `wouldTrash`, a watcher answers with `trashSpared` |
| Freeze Tag — "if the two piles cost the same" | A pile binding that survives between nodes. A second selector rolls a fresh pile. | `resolveFilter` on pile selectors, comparing against the bound pile |
| Brownie, Loaf of Bread — hand adjacency | Hand position captured before `playCard` moves the card out of hand | `core/play.ts` step 1b writes `handIndex` / `handSizeAtPlay` / `handEdge` and marks the two neighbours `sandwich` |
| Synchro Summon — "two cards of the same cost" | A filter axis for "has a same-cost partner in this zone" | `CardFilter.hasSameCostPartnerIn` (`effects/select.ts`) |
| Cult Leader — affordability on the OFFER | `resolveFilter` in the pool and pile-selector paths, not only the selector path | `effects/pools.ts`, plus `livePriceOfDef` so the offer and the gain read one price |
| Hivemind, Infini Scepter — deferred absorb / bind | `NextCardMod.absorbInto` and `.bind` were collected and never consumed | `core/play.ts` steps 6 and 6b; `ABSORB_SELF` resolves the `'self'` sentinel card data has to write |
| Homebrew — absorb with no play in between | Nothing in the DSL wrote `extraEffects` directly; the only door was arming a mod and waiting for a play that might never come | `{op:'absorb'}` (`effects/ops/movement.ts`) |
| Pointer — "Played together" | Triggers are per-**definition** and the partner is whatever was played next, so no card could carry this | `core/play.ts` step 7b, reading the same pair id step 6b mints and `trashWithTrigger` reads for Mutilate |
| Zephrys, Second Time Around, Infinite Realities | S-SIM, cut on purpose (DESIGN-CHOICES §11) | still cut |
| The Eternal Show | The deliberate paradox loop | capped by SB-24 rather than resolved, on purpose |

Two engine defects surfaced only once the clauses above were live, and both
are the SB-42/SB-43 shape — *two implementations of the same thing, and the
reachable one is the incomplete one*:

- **`resolveCardPlay` (`effects/ops/replay.ts`) never consulted `nextCardMods`.**
  `core/play.ts` step 6 absorbs; every play the *effects layer* makes — Ricochet,
  Around the World, `{op:'playCard'}` — went through the other function, watched
  the card resolve and left the modifier armed. Hivemind's promise was kept only
  if the player happened to play a second matching card by hand. `absorbFor` now
  consumes it on that path too, narrowly: the multiply half is already spent by
  `multiplierFor`, so consuming the whole modifier there would take it twice.
- **The Pointer pair id was read off `nextInstanceSeq` without consuming it.**
  Two bindings formed with no instance minted in between collided on one id,
  linking four cards into one pair — trash any of them and all four went. The id
  is now taken from the sequence and the sequence advanced. One skipped instance
  id costs nothing.

`pointerPair` is an instance sequence number, which also meant `selfCounter`
read in the hundreds for any card that had ever been Pointed to. It and the
hand-adjacency counters are in `BOOKKEEPING_COUNTERS` now: a counter the engine
writes on every play is not a counter the card is carrying.

---

## Balance findings from the first harness runs

Not blockers — measurements, recorded here because they are the first real
output of the thing the harness was built for. All **REVISIT**.

| Finding | Numbers | Note |
|---|---|---|
| **The Unconcerned Lion is a free draw-3** | bought 3.1×/match, first buy turn 1, in 100% of winning decks | Threshold 0 and drain 1 means it is always affordable from turn 1, and B61 lets it go into Prophet debt. Working as designed (SB-5, SB-38) — but "always buy on turn 1" is a solved card. Consider a threshold above 0. |
| **Dead Discover cards** | Oh Mr. Lebon offered 344, taken 2 · Solar Eclipse 123/2 · Simple Refining 92/0 · Conjure Aura 74/0 · Rebellion 70/0 | A card offered constantly and never picked is a dead card. This list is the balance worklist, and it regenerates with `npm run balance`. |
| **Discover pick rate** | ~33% across 4,610 offers | Sane for a 3-option Discover; a much lower number would mean the pools are offering junk. |
| **Match length** | end reasons split `emptyPiles` / `jlorePileEmpty` roughly evenly, `turnCap` rare | The two standard end conditions are both live, which is what SB-3 and SB-4 were tuned for. |

Caveat: these come from the greedy bot, which buys the most expensive affordable
card and does not build archetypes. Read it as "which cards are reachable and
obviously good", not as human play.

### SB-63. The player's hand sits below the fold — **RESOLVED**

**Resolved** in the smooth-play UI pass: the table is one viewport-bound grid,
and the hand, the Money / Buys / Actions readout and End turn sit together in a
dock at the bottom of the screen. The page itself never scrolls at laptop sizes.

| viewport | hand top, before (d820ca0) | hand, after | End turn, before | End turn, after | page height before → after |
|---|---|---|---|---|---|
| 1280×720 | (not measured; ≈ as 1366) | 558–712 | 61 | 672–712 | → 720 |
| 1366×768 | 2580 | 606–760 | 61 | 720–760 | 2832 → 768 |
| 1440×900 | 2573 | 738–892 | 61 | 852–892 | 2826 → 900 |
| 1920×1080 | 1520 | 918–1072 | 61 | 1032–1072 | 1772 → 1080 |
| 390×844 | 2885 (a hand card was covered by `.table-body`, unclickable) | 240–394, page scrolls | 183 | 476–516 (UI-2: Play money above it; an anomaly chip that wraps the topbar pushes it down ~35px) | stacked, nothing overlaps |

**What it was.** The table was one normal-flow column: board, then IN PLAY, then
the hand, with End turn in a turn bar at the top. The page grew to fit the
tallest shop column. The entry used to blame the 23-pile Prophet Shop; after
SB-14 cut it to 4 piles the real cause was the **10-pile Draft column at one
pile per row** (132px piles in 220–239px columns, ≈2270px tall below a ~1573px
viewport).

**Why the two earlier attempts failed** (corrected diagnosis). The idea was
never wrong; the budget was.

| Attempt | What actually broke |
|---|---|
| bb23919: `100vh`, each shop column scrolls | About 530–700px of *rigid* content (head, turn bar, a 206px IN PLAY row, a ≈230px hand) shared a 720px viewport with a shrinkable board, leaving the shop columns 0–90px tall. Once the Coppers were played IN PLAY grew and the Buy buttons sat under it. |
| 0745fb7: `.hand { position: sticky; bottom: 0 }` | A sticky footer over the board swallowed clicks aimed at the piles beneath it. |

**What the layout is.** `src/ui/App.tsx` `TableLayout`:

```
.table  height 100dvh; grid
  top     auto            topbar: brand, seat switch, whose turn, clock, anomaly chip, waiting chip, drawer toggle
  seats   auto            opponents strip; a seat expands its tableau in flow
  board   minmax(0, 1fr)  .board-region, the ONLY scroll container for piles
  dock    auto            deck/discard | in-play strip (or prompt bar) + hand | stats, Play money, End turn
  drawer  right column    graveyard + log; closed by default below 1600px wide
```

Shop piles are 98px `mini` tiles in wrapping flex rows, so at 1280–1366 the
Resource, Points and Prophet shops share one row and the Draft shop takes a
second; the board region scrolls internally only when something (an anomaly
chip opened, a seat expanded) squeezes it.

**Rules that keep it resolved.**

1. **Budget the rigid rows.** Topbar + opponents strip + dock must leave the
   board region room for at least one whole shop row (tile + heading), at
   1280×720. Today that is 44 + 66 + 210 against 720. The dock's height is set
   by its 142px dock cards: new controls go into the strip row or the stat
   cluster, never a new dock row.
2. **One scroll container for piles.** Every pile is an in-flow descendant of
   `.board-region` (a `minmax(0, 1fr)` row), with no `overflow: hidden` between
   them and no per-shop scrolling.
3. **Nothing over anything clickable.** No `position: sticky/fixed/absolute`
   over the board or the dock. The hover preview is `pointer-events: none` and
   sits on the far side of the screen; a prompt panel covers the board region
   only, and so does the key sheet; somebody else's prompt is a chip, not an
   overlay. The turn banner and the card-flight layer (`.motion-layer`, UI-2)
   are fixed but `pointer-events: none`, and a flight ghost is a clone with
   every `data-testid` / `data-iid` stripped, so it is never hit-tested,
   clicked or counted as a card (`e2e/interaction.spec.ts`). The drawer is a
   grid column. `.drawer[hidden] { display: none }` must stay: the drawer's own
   `display: flex` beats the browser's `[hidden]` rule and would leave a closed
   drawer holding its 320px column.
4. **Shops are wrapping flex, not `repeat(auto-fill, …)`.** An auto-fill grid
   has no definite width during intrinsic sizing, so each `flex: 0 1 auto` shop
   collapses to one tile wide and the Draft column is 10 rows tall again.
5. **Each `stat-*` test id exists once** (only `StatCluster` renders a `Stat`).
6. **Phone width (< 700px)** stacks the regions and lets the page scroll —
   still with nothing overlaid.

**The regression tests.** `e2e/layout.spec.ts` (part of `npm run e2e`): at
1280×720 and 1366×768 the page does not scroll; the hand, every hand card, the
three stats and End turn are inside the viewport and hit-testable; every pile's
Buy is hit-testable with `document.elementFromPoint` after scrolling the board
region — at the start of the turn, after the Coppers are played and after a buy
(both reverted attempts only broke once IN PLAY had grown); the row budget is
checked against measured `boundingBox()` heights; the hover preview and the
open drawer take no pointer; and at 390px the regions stack without
overlapping and every Buy is reachable. `test/ui-layout.test.ts` pins the pure
parts (prompt placement, every region and stat rendered once).

---

## From the multiplayer pass

### SB-64. When are cards dealt, and what happens to somebody who arrives late?

**Resolved:** a networked room is a **lobby first**. `seedMatch` runs when the
host presses Start, for exactly the people in the room at that moment. A person
who opens the link after that is told the match already started.

The old flow dealt the moment a room was created, for a player count picked on
the start screen before anyone had arrived. Three things followed from that, and
all three were the same bug:

- the second player waited out a hello/retry cycle for a seat that had been
  minted for nobody in particular — about twenty seconds on a spinner;
- a third player had no seat at all, because the host had guessed two, and there
  was no way to say so;
- and the only feedback for either was "Joining…", forever, which is
  indistinguishable from a broken relay.

**What a lobby needs that a spinner does not:** presence has to be a *fact*, not
an inference. A client re-sends `hello` every 4s until it has a view, and the
host drops anyone silent for 20s, so arriving shows up in about two seconds and
a closed tab drops off on its own. Nothing here touches the engine — no match
exists yet.

**No new `RelayMessage.kind`.** The union in `@engine/types` stays four values.
Presence rides `hello`, which already means "I am here"; lobby state rides a
broadcast `view` with no `to`, because a lobby has nothing hidden in it.
`isLobbyPayload` and the client's `isView` are mutually exclusive guards, so
neither reader ever sees the other's traffic — `test/net-lobby.test.ts` asserts
that property over every `view` on the wire.

**The handoff is what actually kills the twenty seconds.** `startHost` takes an
ordered list of seat tokens and binds `seats[i] -> playerOrder[i]` *before it
reads a single message*, so the opening `publishAll` is already addressed to
every real browser. It also takes the lobby's relay cursor, so the new host does
not replay the lobby's history and answer every heartbeat with a full `GameView`.

**A latecomer gets a definite answer, not a timeout.** The final lobby broadcast
carries `started: true` plus the frozen seating order. Someone who opens the link
afterwards reads it and knows immediately which case they are in: their seat
token is in the list (they are a reconnect, and their view is already waiting) or
it is not (the match was dealt without them, and the screen says so). There is no
"free seat" case left to fall into, because the match is dealt for exactly the
lobby roster. A room that is *full but not yet started* is a softer state: that
person keeps knocking, the host sees "somebody is waiting for a seat" with a
**Make room** button, and raising the cap seats them on their next heartbeat with
nobody reloading anything.

**Hotseat is untouched** and deals immediately — there is nobody to wait for. So
does a host resuming a snapshot.

Two details worth keeping:

- **The heartbeat hello does not carry the codex.** It is several hundred card
  ids, repeated every four seconds, into a history every new arrival downloads.
  It goes out on the first hello and again on a reclaim-hello fired the moment a
  client sees `started: true` with its own seat in the list, which is where the
  match actually needs it.
- **`recordName` refuses a name another seat already holds.** Two friends who
  never changed the default both arrive as "Player 1"; `disambiguate()` resolves
  that at deal time, and without the guard the second one's refresh would undo it
  and put two identically named players at one table.

Code: `startLobbyHost()`, `startHost(relay, state, { seats, since })`,
`LobbyPayload` / `isLobbyPayload` in `net/relay.ts`, `useGame`'s `phase`,
`src/ui/Lobby.tsx`. Tests: `test/net-lobby.test.ts`, and the lobby steps in
`e2e/multiplayer.spec.ts` (including a three-browser deal and a latecomer).

## From the smooth-play pass

### SB-65. Every browser runs the engine: hidden information is waived for playtesting

**The question.** A networked press took about 1.8 seconds to show up on the
presser's own screen, the host's included, and about 1.7 seconds on everyone
else's (measured by `e2e/latency.spec.ts` on the dev relay, before this change).
That was the whole design at work: only the host held a `GameState`, so every
click was an intent POSTed to the relay, picked up on the host's next 1 s poll,
reduced, turned into one filtered `view` per seat, POSTed back, and picked up
again on each client's own 1 s poll. The owner's verdict was "about two seconds
per press", and the owner said explicitly that hidden-information security does
not matter for playtesting: trade it for speed.

**The ruling.** Lockstep with optimistic local apply. Every browser, the host
included, folds the same relay list through `reduce` and renders
`viewFor(localState, you)`.

- **The deal is one message.** At Start the host posts a `snapshot` tagged
  `jlore-start/1`: config, seed, each seat's name and codex (collected from the
  lobby hellos, not the host's own codex for everyone), the seat bindings
  (`seats[i]` acts for `playerOrder[i]`), and a checksum of the state it builds.
  Every client calls `createMatch` on exactly that. The first start in a room is
  the match. Nothing about the deal happens outside `reduce`/`createMatch` any
  more (the old `recordCodex`/`recordName` mutated host state on the side).
- **An action is an intent** `{nonce, actions}` from a seat. The acting player
  comes from the envelope's `from` through the seat bindings, never from the
  payload. A batch (one intent, several actions: "play all money") is unrolled
  in order by every client and stops at the first action that is refused or
  that opens a prompt. There is no legality pre-gate: `reduce` refuses illegal
  actions itself, identically everywhere. The old gate silently dropped every
  `reorderHand` (HOST-1/TURN-5); off-turn reorders stay illegal under B20 and the
  UI simply does not offer them.
- **A press renders before it is posted.** `send` reduces the action onto the
  predicted state and renders at once, then posts. When that intent comes back
  in order with nothing foreign ahead of it, the already-computed state becomes
  the confirmed one with no second reduce. If someone else's intent lands
  first, the still-pending actions are refolded onto the new confirmed state.
  A client's posts leave in click order (each waits for the previous answer),
  and a retried post that had in fact landed is skipped by nonce, the same way
  on every client.
- **Nobody is left silently desynced.** At every turn boundary each client
  checksums its confirmed state (key-sorted serialization, log body excluded);
  the host's seat posts its own as `jlore-check/1`. On a mismatch a client first
  rebuilds from the start message and the full intent list; if that still
  disagrees it logs `DESYNC` to the console, asks with `jlore-resync/1`, and
  adopts the host's state from a `jlore-state/1` reply (log trimmed). A state
  too big for one post goes in parts (64K-character slices of its JSON, at
  most 32), and a client still waiting asks again after 15 s, doubling to
  2 min, in case the host was away when it first asked. The session exposes
  `desynced` while that is under way.
- **A reload is a rejoin.** The room is read from index 0 (intents are ~100
  bytes), the start is found, and the list is replayed; the seat cookie binds
  you back to your seat. That includes the host, which used to come back as a
  guest of its own room and had to resume on a new room code. The host's only
  remaining duty after Start is posting checksums; the turn timer never posted
  anything (TurnBar only counts down), so there was no timer duty to move.
  A replaying client holds its own posts until it has read as far as the room
  reached when it started (`GET ?since=end`), then drops what the list already
  holds: no checksum for a past turn, no second answer to an answered resync.
  Before that, a host reloading at turn N queued N checksum posts ahead of its
  own presses, and a guest took each old one whose sum it had evicted for drift
  and rebuilt the match (NET-R2). A guest now ignores a checksum for a boundary
  it no longer remembers. `e2e/host-reload.spec.ts` drives the host case in two
  browsers.
- **Hotseat runs the same code** over the local relay, one session acting for
  every seat: no host loop, no N clients, no tick waits. It follows the seat
  that must choose (a prompt's owner) before the active seat, and a seat picked
  by hand holds only until the turn or prompt changes (HS-2/TURN-4).

**Why it is safe.** `reduce` is pure and seeded; B119 already guarantees that
replaying the same actions reproduces the same state (`npm run replay` relies on
it); and the relay's RPUSH order is one total order every reader sees
identically. The one cross-browser hazard is floating point that ECMAScript
leaves to the implementation (`Math.log` in `expr.ts`): the engine pass pins
the expression evaluator's results so V8 and SpiderMonkey agree, and the
checksums catch anything that slips through.

**What a client can now see.** Everything. Each browser holds the full
`GameState` in memory: every hand, every library in draw order, the seed and RNG
cursor (so future shuffles and draws can be computed), and the options of
prompts that belong to other players. The relay list, readable by anyone with
the room code, carries every seat's codex in the start message and every action
anyone took. What is *not* given up is the UI boundary: React is only ever
handed a `GameView` from `viewFor`, so the table never renders another player's
hand, and `test/net-host.test.ts` (B111, restated) and the e2e hidden-hand DOM
test both still pin that. Peeking takes devtools and intent, which is the bar
this was always held to among friends; it is no longer technically prevented.

**The transport.** `GET /api/room/CODE?stream=1&since=N` is server-sent events,
one event per list entry. On Vercel it is backed by Upstash pub/sub: POST is one
`/pipeline` call (RPUSH + EXPIRE + PUBLISH), and each open stream SUBSCRIBEs
(REST, `text/event-stream`), reads the backlog, then reads from its cursor on
every notification. A stream ends itself after ~50 s to fit `maxDuration: 60`,
and the client reopens from its cursor. The server writes `: open` at once and
`: ready` only when the upstream SUBSCRIBE has confirmed. A stream clears the
client's failure count only after it has shown `: ready`, a heartbeat or an
entry, and has then either lived 5 s or delivered an entry. `event: error` is
always a failure, and so is a `bye` from a stream that proved nothing. Reopens
are at least 1 s apart. Resetting on the first byte, as the first cut did, meant
a refused SUBSCRIBE reopened every 250 ms forever, about 8 requests a second per
client (NET-R1). If the stream cannot be opened, shows no first byte within 4 s,
or fails three times running (about 2 s), the client polls: 1 s at
rest, 250 ms for 5 s after any traffic, a kick right after its own post and when
the tab becomes visible, no hidden-tab backoff during a match, and an idle stop
that anything local undoes and that a visible live match never takes. Every
request has a timeout (4 s GET, 8 s POST) and `stop()` aborts all of them.
Server-side long-polling on LLEN was ruled out: it burns the command quota.

**Free-tier budget, per 4-player hour** (assumptions: ~120 turns an hour and
~6 intents a turn, so ~840 appends with the checksums; 4 streams open):

| | Upstash commands | Vercel invocations |
|---|---|---|
| appends (RPUSH + EXPIRE + PUBLISH each) | ~2,500 | ~840 |
| one LRANGE per open stream per append | ~3,400 | — |
| stream reopen every ~50 s (SUBSCRIBE + backlog read) | ~600 | ~290 |
| **total** | **~6,500** | **~1,130** |

Against Upstash's 500k commands a month that is roughly 75 four-player hours
(roughly 50 if Upstash also bills each pub/sub delivery as a command, which this
pass could not verify); a five-minute lobby adds about 2,000. Against Vercel
Hobby's 1M invocations it is several hundred hours. The streams hold 4 function
instances open for the hour, mostly waiting on the network: check function
duration / active CPU in the Vercel usage tab after the first real session. If
the push path does not work in production, the polling fallback costs about
15,000-20,000 commands per 4-player hour, roughly 25-30 hours a month.

**Measured on the dev relay** (`e2e/latency.spec.ts`): a networked press now
renders for the presser in 57-132 ms and reaches the other browser in 86-195 ms,
from ~1.8 s and ~1.7 s. Engine cost per press is small (reduce 1-2 ms, viewFor
~0.5 ms, a checksum 4-6 ms once per turn); the rest is React rendering the
table. A cold rejoin that replays an entire 180-turn 4-player match (1,409
actions) took 2.3 s in Node.

**Verified against production services, and not.** `npm run relay:check` against
the real Upstash database (2026-09-11) passes: the `/pipeline` append, LRANGE,
`since=end`, TTL, and the REST `/subscribe` push path, with 139 ms from an append
to the event on an open stream. It drives `streamRoom` directly, so two things
remain unmeasured until a deploy: whether Vercel's Node runtime streams
`res.write` unbuffered, and the latency other players see on the deployed site.
If Vercel buffers, the 4 s first-byte timeout and the rule above send every
client to polling rather than into a retry loop.

Code: `src/net/lockstep.ts` (`LockstepCore`, `startSession`, `makeStart`,
`stateChecksum`), `src/ui/useGame.ts`, `src/net/relay.ts` (`startPolling`,
`makeRelay().stream`), `src/relay/roomHandler.ts` (`streamRoom`),
`src/relay/upstash.ts`. Tests: `test/net-lockstep.test.ts`,
`test/net-stream.test.ts`, `test/net-host.test.ts` (B111).
