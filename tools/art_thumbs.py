"""
npm run art:thumbs

Writes public/art/thumb/<key>.webp: a small copy of every card and aura
illustration for the places the art is drawn small (hand, piles, play strip,
opponent tableaux). The full 512px jpg stays where it is and is what the
hover preview shows.

Why: a table opens on ~26 illustrations at ~50 KB and 512x512 each, drawn
into boxes ~130px wide. Every new card fetched and decoded a quarter-megapixel
image to fill a thumbnail, and art popped in a beat after the card. At 256px
WebP a thumbnail is ~8-12 KB and decodes in a fraction of the time.

Deterministic and resumable like art_render.py: a thumb is only rewritten when
its source jpg is newer, so re-running after `art:generate` touches only what
changed. Needs Pillow with WebP support (`pip install pillow`); PYTHON picks
the interpreter.
"""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover - a message beats a traceback here
    sys.exit("art_thumbs: needs Pillow (pip install pillow)")

ROOT = Path(__file__).resolve().parent.parent
ART = ROOT / "public" / "art"
THUMB = ART / "thumb"
SIZE = 256
QUALITY = 72


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[1])
    parser.add_argument("--force", action="store_true", help="rewrite every thumbnail")
    args = parser.parse_args()

    THUMB.mkdir(parents=True, exist_ok=True)
    sources = sorted(ART.glob("*.jpg"))
    written = skipped = 0
    for src in sources:
        out = THUMB / (src.stem + ".webp")
        if not args.force and out.exists() and out.stat().st_mtime >= src.stat().st_mtime:
            skipped += 1
            continue
        with Image.open(src) as im:
            im = im.convert("RGB")
            im.thumbnail((SIZE, SIZE), Image.LANCZOS)
            im.save(out, "WEBP", quality=QUALITY, method=6)
        written += 1

    # A thumb whose jpg is gone would be served for a card that no longer exists.
    stale = [t for t in THUMB.glob("*.webp") if not (ART / (t.stem + ".jpg")).exists()]
    for t in stale:
        t.unlink()

    print(f"art_thumbs: {written} written, {skipped} up to date, {len(stale)} stale removed, {len(sources)} sources")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
