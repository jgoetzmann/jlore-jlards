# Card art

One image per card and per aura, named for the card's `art.key` — which is the
card's id, so `temple_marketplace` is `/art/temple_marketplace.jpg`. A missing
file falls back to a generated placeholder showing the card name, so the game
stays playable with this directory empty.

The set is **generated, and regenerating it is one command**:

```bash
npm run art:generate     # render everything still missing
npm run art:status       # mark the catalog: placeholder -> final
npm run art:manifest     # rewrite docs/ART-MANIFEST.md
```

`tools/gen-art.ts` builds one prompt per card out of the card's own catalog data
— name, subtypes, type, rarity — against a single fixed house style, and
`tools/art_render.py` renders it locally on the GPU. Adding a card to
`src/cards/` gets art from the same rules the other 558 got; there is no
per-card prompt to write.

## Conventions

- **Size:** 512×512 JPEG, opaque. The client draws the card frame, so the art is
  the illustration only and never needs alpha. JPEG rather than PNG because the
  art is photographic-painterly: PNG would take this directory from ~14 MB to
  ~250 MB for no visible difference.
- **Composition:** full bleed. `.card-art` renders at `height: 74px` with
  `object-fit: cover`, so only a wide band through the middle survives. Art that
  composes as a small object centred on a large background loses its subject to
  the crop.
- **Animation:** set `art.anim` on the card to a preset name and the client plays
  it when the card resolves. Presets in use: `coin`, `shuffle`, `explode`,
  `summon`, `trash`.
- **Fused cards** render with a composite treatment and use `art.key = "fused"`,
  so a single `fused.jpg` covers every fusion.

## Determinism, and re-rolling a bad one

Every image's seed is a hash of its art key, so the same card renders the same
picture on any machine, and a run that is interrupted can simply be re-run — it
skips what is already on disk.

At 559 images a good prompt still draws the occasional dud. Copper's first render
came out as a ceramic plate; the identical prompt on a different seed produced a
hoard of coins. So a specific card can be re-rolled without touching the prompt
rules the rest depend on:

```bash
npm run art:generate -- --reroll=copper
```

That bumps the card's salt in `tools/art-seeds.json` and re-renders only it. The
bump is committed, which is what keeps the set reproducible — a fresh clone
regenerates the *accepted* image rather than rolling again.

## Replacing generated art with commissioned art

Drop a 512×512 `.jpg` in here under the card's art key and set that card's
`art.artist` in `src/cards/`. Nothing else needs to change, and
`npm run art:generate` will not overwrite it — it only renders keys with no file.
