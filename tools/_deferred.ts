/** TEMPORARY — collect every deferred card from the fix + cleanup runs. Delete when done. */
import { readFileSync, writeFileSync } from 'node:fs';

interface Entry {
  cardId: string;
  engineFile?: string;
  what?: string;
  why?: string;
}

const out: string[] = [];
let n = 0;

for (const path of process.argv.slice(2)) {
  const raw = JSON.parse(readFileSync(path, 'utf8')) as {
    result: { needsEngine?: Entry[]; stillBroken?: Entry[]; skippedDetail?: Entry[] };
  };
  const r = raw.result;
  for (const [label, list] of [
    ['needsEngine', r.needsEngine ?? []],
    ['stillBroken', r.stillBroken ?? []],
  ] as const) {
    for (const e of list) {
      n += 1;
      out.push(`\n### ${e.cardId}  [${label}${e.engineFile ? ' -> ' + e.engineFile : ''}]`);
      out.push((e.what ?? e.why ?? '').trim());
    }
  }
}

writeFileSync('deferred.md', `# Deferred cards (${n})\n${out.join('\n')}\n`, 'utf8');
console.log(`${n} deferred entries -> deferred.md`);
