/**
 * npm run art:generate
 *
 * Fills `public/art/` with one illustration per card and per aura.
 *
 * The prompt for a card is built from the card's own catalog data — name,
 * subtypes, type, rarity, flavor — against a single fixed house style. That
 * split is the whole design: the house style is what makes 559 images read as
 * one game, and the per-card clause is what makes them different from each
 * other. Nothing here is hand-authored per card, so adding a card to
 * `src/cards/` gets art from the same rules the other 533 got.
 *
 * This file owns the *prompts*; `tools/art_render.py` owns the *pixels*. The
 * seam is `dist-cards/art-jobs.json`, which is the same seam
 * `npm run cards:export` already uses to hand catalog data to art tooling.
 * Prompt construction stays in the typed world where card data lives, and
 * rendering stays where torch lives.
 *
 * Rendering is **local**, on the machine's own GPU. The hosted services that
 * would do this are rate-limited to roughly one image per 45 seconds per
 * address, which is seven hours for one full run and a failure every time the
 * limit moves. A local model is free, offline, unmetered, and — because it takes
 * a real `negative_prompt` — the only way to reliably suppress the lettering and
 * decorative borders that a positive-only prompt actively summons.
 *
 * Runs are **deterministic and resumable**. The seed is an FNV-1a hash of the
 * art key, so the same card always renders the same image, and a card whose file
 * already exists is skipped unless `--force`. Interrupting the run and starting
 * it again costs nothing.
 *
 * Output is JPEG, not PNG: the art is opaque (the client draws the card frame
 * itself, so alpha is never used) and PNG would inflate the set from ~14 MB to
 * ~250 MB of committed binaries for no visible gain.
 *
 *   npm run art:generate                     # everything still missing
 *   npm run art:generate -- --sample         # one spread across rarity/archetype
 *   npm run art:generate -- --only=copper,jlore
 *   npm run art:generate -- --force          # regenerate, ignoring what exists
 *   npm run art:generate -- --limit=40 --steps=8
 *   npm run art:generate -- --prompts-only   # write the job file, render nothing
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { AuraDefinition, CardDefinition, Rarity } from '@engine/types';
import { ART_EXT, bootstrap, intArg, parseArgs } from './bootstrap';

const ART_DIR = resolve(process.cwd(), 'public', 'art');
const JOBS_PATH = resolve(process.cwd(), 'dist-cards', 'art-jobs.json');
const SEEDS_PATH = resolve(process.cwd(), 'tools', 'art-seeds.json');
const RENDERER = resolve(process.cwd(), 'tools', 'art_render.py');
const SIZE = 512;

// ---------------------------------------------------------------------------
// House style — the constant that makes the set cohere
// ---------------------------------------------------------------------------

/**
 * Setting, per the design doc: 2,000 years forward, reality unravelling, a lone
 * Navigator carrying the Stellar Codex. Indigo-and-gold cosmic mythology.
 *
 * Two words are deliberately absent. "Trading card" makes the model paint *a
 * card* — a bordered rectangle floating on a backdrop — which is wrong twice
 * over, because the client already draws the frame. And no clause here is
 * phrased as "no text" or "no border": a positive prompt has no negation, so
 * naming a thing summons it. Both were observed, not theorised. Everything to
 * suppress lives in NEGATIVE_STYLE, which the renderer passes as a real
 * `negative_prompt`.
 *
 * "full bleed composition filling the entire image" is load-bearing for the same
 * reason: `.card-art` is a 74px-tall `object-fit: cover` band, so anything that
 * composes as a small object centred on a large background loses its subject to
 * the crop.
 */
const HOUSE_STYLE = [
  'fantasy illustration',
  'painterly oil painting',
  'volumetric light',
  'deep indigo violet and molten gold',
  'cosmic',
  'full bleed',
  'dark background',
].join(', ');

/** Passed to the renderer as a true negative prompt. Also budgeted to 77. */
const NEGATIVE_STYLE = [
  'text', 'letters', 'words', 'signature', 'watermark', 'logo',
  'border', 'frame', 'card frame', 'matte',
  'ui', 'collage', 'split image', 'grid',
  'blurry', 'lowres', 'deformed', 'bad anatomy', 'extra limbs',
].join(', ');

/**
 * Rarity drives grandeur, the same way it drives pile size and pull weight.
 * Kept to a few words each — see the token budget note on `promptForCard`.
 */
const GRANDEUR: Record<Rarity, string> = {
  basic: 'iconic and clean',
  token: 'small and humble',
  common: 'modest, grounded',
  rare: 'elegant, refined, glowing',
  epic: 'dramatic, erupting arcane energy',
  legendary: 'majestic, radiant, heroic scale',
  mythic: 'reality-breaking, overwhelming scale',
};

/**
 * A deterministic camera, picked from the art key. Without it the model falls
 * into one composition — a centred symmetrical figure with a glow behind it —
 * for card after card, which is very visible once you look at 60 of them on one
 * sheet. Object-like cards get a different set of shots from scene-like ones,
 * because "sweeping wide vista" is wrong for a coin and "still life" is wrong
 * for a battle.
 */
const OBJECT_SHOTS = [
  'dramatic close-up',
  'ornate still life',
  'macro detail shot',
  'hero object study',
];
const SCENE_SHOTS = [
  'sweeping wide vista',
  'low angle looking up',
  'dynamic action moment',
  'intimate character portrait',
];

/**
 * Subtype motifs, most specific first. A card's first match wins, so `Felinor`
 * beats `Food` on a cat that eats. These are the archetypes the catalog is
 * actually built around (§11 of the gameplay doc).
 */
const SUBTYPE_MOTIF: [string, string][] = [
  ['Felinor', 'a mystical cosmic cat with starlit fur and knowing eyes'],
  ['Truss', 'a colossal glowing geometric scaffold of impossible architecture'],
  ['Plague', 'creeping bioluminescent spores and beautiful decay'],
  ['Scripture', 'an illuminated sacred scroll unrolling in midair, radiating light'],
  ['Book', 'an ancient heavy tome, pages turning by themselves, glowing script'],
  ['Relic', 'an ancient ornate artifact resting on a stone pedestal'],
  ['Soul Shard', 'a glowing crystalline shard holding a captured soul'],
  ['Goblin', 'a small scheming goblin creature with clever greedy eyes'],
  ['Warhero Token', 'an armored champion standing against the dark'],
  ['Warhero', 'an armored champion standing against the dark'],
  ['Egg', 'an ornate jewelled cosmic egg cradled in light'],
  ['Scarab', 'a jewelled golden scarab beetle, iridescent carapace'],
  ['Lunar Fragment', 'a drifting shard of a shattered moon'],
  ['Grape', 'a heavy cluster of luminous cosmic grapes'],
  ['Distilled', 'a glass vessel of glowing distilled spirit'],
  ['Garlic', 'a bulb of silver garlic wreathed in warding light'],
  ['Carrot', 'a radiant root vegetable pulled from starlit soil'],
  ['Fruit', 'a impossibly ripe fruit glowing from within'],
  ['Food', 'a sumptuous arcane feast, steam and golden light'],
  ['CN', 'a dystopian megacorporation broadcast, cold corporate propaganda spectacle'],
  ['Funding', 'a cold boardroom ritual of contracts, ledgers and falling money'],
  ['Highroller', 'a neon gambling den of dice, chips and reckless fortune'],
  ['Prophet', 'a robed oracle beneath burning sacred sigils'],
  ['Miracle', 'a divine miracle breaking through the clouds, radiant blessing'],
  ['Chaos', 'reality tearing itself apart in impossible colors'],
  ['Paradox', 'a time paradox folding back into itself, looping clockwork'],
  ['Fusion', 'two artifacts violently merging into one new thing'],
  ['Summon', 'a blazing summoning circle opening onto elsewhere'],
  ['Ricochet', 'bolts of energy ricocheting between mirrors'],
  // The seven Basic piles are the most-looked-at art in the game — the opening
  // deck is 7 Copper and 3 Tix — so they get the most specific motifs here.
  ['Diamond', 'an enormous cut diamond blazing with prismatic light'],
  ['Platinum', 'a gleaming platinum ingot on dark velvet'],
  ['Gold', 'a spilling hoard of radiant gold coins'],
  // "spilling across dark stone" read as *stone* on both of these and drew a
  // floor. Name the metal and the fact that it is money, and nothing else.
  ['Silver', 'a mound of bright polished silver coins, shining white metal money'],
  ['Copper', 'a mound of bright polished copper coins, shining orange metal money'],
  ['Jlore', 'a supreme golden victory monument crowned in light'],
  ['Robux', 'a polished floating victory medallion'],
  ['Tix', 'a small glowing victory token, engraved metal'],
  ['Shadiris', 'a veiled figure of living shadow'],
  ['Kwzki', 'the sigil of a high council of star-priests'],
  ['Hand Box', 'an ornate puzzle box opening in the palm of a hand'],
  ['Dynamic', 'shifting unstable runes rearranging themselves'],
  ['Tribal', 'a gathering of banners and totems'],
  ['Crafted', 'a workbench of half-finished arcane components'],
];

/** Fallback when no subtype matched: the card's type still says a lot. */
const TYPE_MOTIF: Record<string, string> = {
  Resource: 'a hoard of glowing currency and treasure',
  Points: 'a triumphant victory monument',
  Token: 'a small conjured object hanging in the air',
  Relic: 'an ancient ornate artifact',
  Book: 'an ancient glowing tome',
  Food: 'a sumptuous arcane feast',
  Action: 'a dramatic magical event unfolding',
};

const AURA_MOTIF: Record<string, string> = {
  heroic: 'a radiant heroic blessing sigil burning in the air, an emblem of granted power',
  celestial: 'a vast celestial constellation enchantment written across the night sky',
  hypercelestial:
    'a reality-defining cosmic phenomenon, a god-scale event rewriting the heavens',
};

// ---------------------------------------------------------------------------
// Prompt construction
// ---------------------------------------------------------------------------

/**
 * Names in this catalog are jokes as often as they are nouns ("401J",
 * "MEOW MEOW MEOW", "Feel so Clean Like a Prophet Machine"). Passing one raw
 * invites the model to letter it onto the canvas, so it is introduced as the
 * *subject of a scene* rather than as a title, and stripped of the punctuation
 * that reads as typography.
 */
export function subjectOf(name: string): string {
  const cleaned = name
    .replace(/[«»"“”'’]/g, '')
    .replace(/[!?]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return cleaned.length > 0 ? cleaned : 'an unknown relic';
}

function motifForCard(card: CardDefinition): string {
  for (const [sub, motif] of SUBTYPE_MOTIF) {
    if (card.subtypes.indexOf(sub) >= 0) return motif;
  }
  for (const t of card.types) {
    const m = TYPE_MOTIF[t];
    if (m) return m;
  }
  return 'a strange artifact from a collapsing future';
}

/** Things vs. happenings, for choosing a camera. Actions are happenings. */
function isObjectLike(card: CardDefinition): boolean {
  for (const t of ['Resource', 'Points', 'Token', 'Relic', 'Book', 'Food']) {
    if (card.types.indexOf(t as CardDefinition['types'][number]) >= 0) return true;
  }
  return false;
}

/**
 * Salted, so that a re-roll re-rolls the *composition* and not just the
 * diffusion noise. Copper spent two rolls as a stone floor because the camera
 * came from the unsalted key: same shot, same failure, differently lit.
 */
function shotFor(key: string, salt: number, objectLike: boolean): string {
  const pool = objectLike ? OBJECT_SHOTS : SCENE_SHOTS;
  const pick = pool[seedFor(key, salt) % pool.length];
  return pick ?? pool[0]!;
}

/**
 * **Token budget.** CLIP truncates at 77 tokens and says so only in a warning
 * that is easy to miss in a 559-image run. Anything past the cut is silently
 * dropped, and because the style sits at the end of the prompt, overrunning
 * costs exactly the terms that hold the set together. Everything below is kept
 * short on purpose and the whole prompt lands near 45 tokens.
 *
 * The first casualty of that budget was flavor text. It reads beautifully and
 * it is worth 15-20 tokens of a 77-token budget, which is the style section.
 * The card's name already carries the same idea in four tokens.
 */
export function promptForCard(card: CardDefinition, salt = 0): string {
  const key = card.art ? card.art.key : card.id;
  return [
    subjectOf(card.name),
    motifForCard(card),
    GRANDEUR[card.rarity] ?? GRANDEUR.common,
    shotFor(key, salt, isObjectLike(card)),
    HOUSE_STYLE,
  ].join(', ');
}

export function promptForAura(aura: AuraDefinition): string {
  const motif = AURA_MOTIF[String(aura.tier)] ?? AURA_MOTIF.celestial;
  return [subjectOf(aura.name), motif, 'a condition of the world', HOUSE_STYLE].join(', ');
}

// ---------------------------------------------------------------------------
// Deterministic seed
// ---------------------------------------------------------------------------

/** FNV-1a over the art key plus its salt. Same inputs, same picture, forever. */
export function seedFor(key: string, salt = 0): number {
  const s = salt === 0 ? key : key + '#' + salt;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h % 2000000000;
}

/**
 * Per-key seed salts, committed alongside the catalog.
 *
 * At this scale the prompt stops being the only variable. A good prompt still
 * draws a dud every so often — Copper's first render came out as a ceramic
 * plate, and the identical prompt on another seed produced a hoard of coins —
 * so the art pass needs a way to say "that one, again, differently" without
 * touching the prompt rules that the other 558 depend on.
 *
 * `--reroll=copper` bumps that key's salt and re-renders only it. The bump is
 * recorded here, so the set stays reproducible: a fresh clone regenerating from
 * scratch gets the same accepted image, not another roll of the dice.
 */
function loadSalts(): Record<string, number> {
  try {
    const raw = JSON.parse(readFileSync(SEEDS_PATH, 'utf8')) as { salts?: Record<string, number> };
    return raw && raw.salts ? raw.salts : {};
  } catch {
    return {};
  }
}

function saveSalts(salts: Record<string, number>): void {
  const ordered: Record<string, number> = {};
  for (const k of Object.keys(salts).sort()) ordered[k] = salts[k]!;
  writeFileSync(
    SEEDS_PATH,
    JSON.stringify(
      { note: 'Per-art-key seed salts. Bumped by `npm run art:generate -- --reroll=<key>`.', salts: ordered },
      null,
      2,
    ) + '\n',
    'utf8',
  );
}

// ---------------------------------------------------------------------------
// Job list
// ---------------------------------------------------------------------------

interface Job {
  key: string;
  name: string;
  prompt: string;
  negative: string;
  seed: number;
}

/** JPEG SOI marker. A truncated or half-written file fails this. */
function looksLikeJpeg(buf: Buffer): boolean {
  return buf.length > 2048 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
}

function artPath(key: string): string {
  return resolve(ART_DIR, key + '.' + ART_EXT);
}

/** Already on disk and plausibly an image. */
function haveArt(key: string): boolean {
  const p = artPath(key);
  if (!existsSync(p)) return false;
  try {
    return looksLikeJpeg(readFileSync(p));
  } catch {
    return false;
  }
}

/** A spread across rarity and archetype, for judging the house style. */
function sampleOf(jobs: Job[], cards: CardDefinition[]): Job[] {
  const want = [
    'copper',
    'jlore',
    'recurring_felinor',
    '401j',
    'temple_marketplace',
    'prophesized_jlore',
    'call_to_chaos',
    'ebon_blade',
    'novice_acolyte',
    'blood_diamond_cutter',
    'aura_shooting_star',
    'aura_dead_sea_scroll',
  ];
  const byKey = new Map(jobs.map((j) => [j.key, j]));
  const out: Job[] = [];
  for (const k of want) {
    const j = byKey.get(k);
    if (j) out.push(j);
  }
  // Backfill with one card per rarity if any named sample is missing.
  if (out.length < want.length) {
    const seen = new Set(out.map((j) => j.key));
    for (const r of ['common', 'rare', 'epic', 'legendary', 'mythic', 'token'] as Rarity[]) {
      const c = cards.find((x) => x.rarity === r && x.art && !seen.has(x.art.key));
      if (c && c.art) {
        const j = byKey.get(c.art.key);
        if (j) {
          out.push(j);
          seen.add(c.art.key);
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  let force = args.force === 'true';
  const limit = intArg(args, 'limit', 0);

  const salts = loadSalts();
  const makeJob = (key: string, name: string, prompt: string): Job => ({
    key,
    name,
    prompt,
    negative: NEGATIVE_STYLE,
    seed: seedFor(key, salts[key] ?? 0),
  });

  // --reroll bumps the salt for the named keys and regenerates only those.
  let rerollOnly: Set<string> | null = null;
  if (args.reroll) {
    const keys = args.reroll.split(',').map((s) => s.trim()).filter(Boolean);
    for (const k of keys) salts[k] = (salts[k] ?? 0) + 1;
    saveSalts(salts);
    rerollOnly = new Set(keys);
    force = true;
    process.stdout.write(
      'art:generate — rerolled ' + keys.length + ' key(s): ' + keys.join(', ') + '\n',
    );
  }

  const { cards, auras } = bootstrap();

  let jobs: Job[] = [];
  for (const c of cards) {
    if (!c.art || !c.art.key) continue;
    jobs.push(makeJob(c.art.key, c.name, promptForCard(c, salts[c.art.key] ?? 0)));
  }
  for (const a of auras) {
    if (!a.art || !a.art.key) continue;
    jobs.push(makeJob(a.art.key, a.name, promptForAura(a)));
  }
  // Fused cards all share one composite treatment (public/art/README.md).
  jobs.push(
    makeJob(
      'fused',
      'Fused',
      [
        'two different arcane artifacts violently merging into one new thing',
        'a seam of raw light where the halves meet, fragments orbiting the join',
        GRANDEUR.epic,
        HOUSE_STYLE,
      ].join(', '),
    ),
  );

  if (rerollOnly) {
    const want = rerollOnly;
    jobs = jobs.filter((j) => want.has(j.key));
    const missing = [...want].filter((k) => !jobs.some((j) => j.key === k));
    for (const m of missing) process.stdout.write('  ! no such art key: ' + m + '\n');
  }
  if (args.only) {
    const want = new Set(args.only.split(',').map((s) => s.trim()).filter(Boolean));
    jobs = jobs.filter((j) => want.has(j.key));
  }
  if (args.sample === 'true') jobs = sampleOf(jobs, cards);
  if (!force) jobs = jobs.filter((j) => !haveArt(j.key));
  if (limit > 0) jobs = jobs.slice(0, limit);

  mkdirSync(ART_DIR, { recursive: true });
  mkdirSync(resolve(process.cwd(), 'dist-cards'), { recursive: true });
  writeFileSync(
    JOBS_PATH,
    JSON.stringify({ size: SIZE, outDir: ART_DIR, count: jobs.length, jobs }, null, 2),
    'utf8',
  );

  const total = jobs.length;
  if (total === 0) {
    process.stdout.write('art:generate — nothing to do; every art key already has a file\n');
    return;
  }
  process.stdout.write('art:generate — ' + total + ' to render; jobs at ' + JOBS_PATH + '\n');

  if (args['prompts-only'] === 'true') {
    process.stdout.write('art:generate — --prompts-only, rendering nothing\n');
    return;
  }

  // The renderer streams its own progress; inherit stdio so it reaches the
  // terminal live rather than arriving in one lump at the end.
  const py = process.env.PYTHON ?? 'python';
  const rendererArgs = [RENDERER, '--jobs=' + JOBS_PATH];
  for (const pass of ['steps', 'guidance', 'model', 'quality']) {
    if (args[pass] !== undefined) rendererArgs.push('--' + pass + '=' + args[pass]);
  }
  const res = spawnSync(py, rendererArgs, { stdio: 'inherit' });

  if (res.error) {
    process.stdout.write('art:generate — could not start ' + py + ': ' + String(res.error) + '\n');
    process.exitCode = 1;
    return;
  }
  if (res.status !== 0) {
    process.stdout.write('art:generate — renderer exited ' + String(res.status) + '\n');
    process.exitCode = res.status ?? 1;
    return;
  }

  // Trust nothing: count what actually landed on disk.
  const missing = jobs.filter((j) => !haveArt(j.key));
  if (missing.length > 0) {
    process.stdout.write('art:generate — ' + missing.length + ' still missing:\n');
    for (const m of missing.slice(0, 20)) process.stdout.write('  ! ' + m.key + '\n');
    process.stdout.write('re-run to retry only what is still missing\n');
    process.exitCode = 1;
  } else {
    process.stdout.write('art:generate — all ' + total + ' art keys present\n');
  }
}

main();
