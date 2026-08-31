#!/usr/bin/env python3
"""Turn selected cover masters into the web derivatives used on cassette labels.

The artwork derivative is square because it is printed inside the cassette-label
window. Masters that are not square are cropped using a per-cover anchor rather
than a blind centre crop, so a portrait painting can keep its title and subject.

Usage:
    python tools/prepare_artwork.py masters/ assets/img/sleeves/

Outputs, for each master:
    <slug>-640.webp    gallery tile
    <slug>-1280.webp   deck / detail / high-density
    <slug>-640.jpg     fallback for anything without WebP support
    <slug>-1280.jpg
"""

from __future__ import annotations

import sys
from pathlib import Path

try:
    from PIL import Image
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")

SIZES = (640, 1280)

# Vertical anchor for cropping a non-square master to 1:1.
# 0.0 keeps the top of the image, 0.5 centres, 1.0 keeps the bottom.
# Portrait sleeves normally carry the title at the top, so they anchor high.
ANCHORS: dict[str, float] = {
    "dogtushya": 0.0,
    "dogtushya-v2": 0.0,
}
DEFAULT_ANCHOR = 0.5


def square_crop(image: Image.Image, anchor: float) -> Image.Image:
    width, height = image.size
    if width == height:
        return image
    edge = min(width, height)
    if height > width:
        top = round((height - edge) * anchor)
        return image.crop((0, top, edge, top + edge))
    left = round((width - edge) * anchor)
    return image.crop((left, 0, left + edge, edge))


def main(source_dir: Path, output_dir: Path) -> int:
    masters = sorted(
        p for p in source_dir.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    )
    if not masters:
        print(f"No sleeve masters found in {source_dir}", file=sys.stderr)
        return 1

    output_dir.mkdir(parents=True, exist_ok=True)

    for master in masters:
        slug = master.stem
        anchor = ANCHORS.get(slug, DEFAULT_ANCHOR)
        with Image.open(master) as image:
            image = image.convert("RGB")
            cropped = square_crop(image, anchor)
            for size in SIZES:
                resized = cropped.resize((size, size), Image.LANCZOS)
                resized.save(output_dir / f"{slug}-{size}.webp", "WEBP", quality=82, method=6)
                resized.save(output_dir / f"{slug}-{size}.jpg", "JPEG", quality=84, optimize=True, progressive=True)
        print(f"{slug}: {image.size[0]}x{image.size[1]} master, anchor {anchor} -> 640 + 1280")

    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    src = Path(args[0]) if args else Path("masters")
    dst = Path(args[1]) if len(args) > 1 else Path("assets/img/sleeves")
    raise SystemExit(main(src, dst))
