# Card art

Drop art here as `<art.key>.png`. Every card in the catalog carries an `art`
slot, and `art.key` is the card's id, so `temple_marketplace` looks for
`/art/temple_marketplace.png`. A missing file falls back to a generated
placeholder showing the card name, so the game is playable with this directory
empty.

## Workflow

```bash
npm run art:manifest      # writes docs/ART-MANIFEST.md — every card, grouped, with its status
```

The manifest lists placeholders first, so it is a worklist rather than a
spreadsheet. As art lands, bump the card's `art.status` from `placeholder` to
`sketch` to `final` and set `artist`.

## Conventions

- **Size:** 512×512 PNG, transparent background. The card frame is drawn by the
  client, so art should be the illustration only.
- **Animation:** set `art.anim` on the card to a preset name and the client will
  play it when the card resolves. Presets in use: `coin`, `shuffle`, `explode`,
  `summon`, `trash`.
- **Fused cards** render with a composite treatment and use `art.key = "fused"`,
  so a single `fused.png` covers every fusion.
