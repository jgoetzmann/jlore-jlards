/**
 * npm run art:status
 *
 * Marks catalog entries whose art has actually landed.
 *
 * `art.status` is the art pipeline's worklist field: `docs/ART-MANIFEST.md`
 * sorts by it and puts placeholders on top, so a stale `placeholder` on a card
 * that already has a picture is a lie that costs somebody a second look. This
 * walks `public/art/`, and for every entry whose file is really there, rewrites
 * the card source from `placeholder` to `final` with an artist credit.
 *
 * It **verifies before it writes**. If any catalog entry is still missing its
 * file, nothing is edited at all and the missing keys are listed — a half-marked
 * catalog is worse than an unmarked one, because the manifest would then
 * under-report the remaining work.
 *
 *   npm run art:status              # verify, then mark
 *   npm run art:status -- --check   # verify only, write nothing
 */

import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { ART_EXT, bootstrap, parseArgs } from './bootstrap';

const ART_DIR = resolve(process.cwd(), 'public', 'art');
const CARDS_DIR = resolve(process.cwd(), 'src', 'cards');

/** Names the thing that drew it. Provenance belongs in the data, not a README. */
const ART_CREDIT = 'LCM Dreamshaper v7';

const PLACEHOLDER = "status: 'placeholder'";
const REPLACEMENT = "status: 'final', artist: '" + ART_CREDIT + "'";

function tsFilesUnder(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...tsFilesUnder(full));
    else if (entry.endsWith('.ts')) out.push(full);
  }
  return out;
}

function hasArtFile(key: string): boolean {
  const p = resolve(ART_DIR, key + '.' + ART_EXT);
  if (!existsSync(p)) return false;
  try {
    const buf = readFileSync(p);
    return buf.length > 2048 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff;
  } catch {
    return false;
  }
}

function main(): void {
  const args = parseArgs(process.argv.slice(2));
  const { cards, auras } = bootstrap();

  const entries: { key: string; name: string }[] = [];
  for (const c of cards) if (c.art && c.art.key) entries.push({ key: c.art.key, name: c.name });
  for (const a of auras) if (a.art && a.art.key) entries.push({ key: a.art.key, name: a.name });

  const missing = entries.filter((e) => !hasArtFile(e.key));
  process.stdout.write(
    'art:status — ' + entries.length + ' catalog entries, ' +
      (entries.length - missing.length) + ' with art on disk\n',
  );

  if (missing.length > 0) {
    process.stdout.write('art:status — ' + missing.length + ' still missing art:\n');
    for (const m of missing.slice(0, 30)) process.stdout.write('  ! ' + m.key + '  (' + m.name + ')\n');
    if (missing.length > 30) process.stdout.write('  ... and ' + (missing.length - 30) + ' more\n');
    process.stdout.write('run `npm run art:generate` first; nothing was written\n');
    process.exitCode = 1;
    return;
  }

  if (args.check === 'true') {
    process.stdout.write('art:status — --check, every entry has art; nothing written\n');
    return;
  }

  let files = 0;
  let marked = 0;
  for (const file of tsFilesUnder(CARDS_DIR)) {
    const before = readFileSync(file, 'utf8');
    if (before.indexOf(PLACEHOLDER) < 0) continue;
    const hits = before.split(PLACEHOLDER).length - 1;
    writeFileSync(file, before.split(PLACEHOLDER).join(REPLACEMENT), 'utf8');
    files++;
    marked += hits;
  }

  process.stdout.write(
    'art:status — marked ' + marked + ' art slots final across ' + files + ' files\n',
  );
  if (marked === 0) process.stdout.write('art:status — nothing left on placeholder\n');
}

main();
