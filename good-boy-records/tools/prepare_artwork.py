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
    from PIL import Image, ImageDraw, ImageFont
except ImportError:  # pragma: no cover
    sys.exit("Pillow is required: pip install Pillow")

SIZES = (640, 1280)

# Vertical anchor for cropping a non-square master to 1:1.
# 0.0 keeps the top of the image, 0.5 centres, 1.0 keeps the bottom.
# Portrait sleeves normally carry the title at the top, so they anchor high.
ANCHORS: dict[str, float] = {
}
DEFAULT_ANCHOR = 0.5
PLACEHOLDER_BASE = "gbr-placeholder"


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




def placeholder_image(size: int = 1280) -> Image.Image:
    """Create an internal neutral sleeve used when curated artwork is absent.

    Generated locally so deployment never depends on a remote placeholder service.
    """
    image = Image.new("RGB", (size, size), (18, 20, 22))
    draw = ImageDraw.Draw(image)

    # Quiet radial-ish hardware glow made from concentric rounded rectangles.
    for i in range(18, 0, -1):
        inset = int(size * (0.12 + (18 - i) * 0.006))
        tone = 30 + i * 2
        draw.rounded_rectangle(
            (inset, inset, size - inset, size - inset),
            radius=int(size * 0.045),
            outline=(tone + 18, tone + 9, max(20, tone - 8)),
            width=max(2, int(size * 0.004)),
        )

    # Stylised cassette window.
    body = (int(size * 0.18), int(size * 0.31), int(size * 0.82), int(size * 0.69))
    draw.rounded_rectangle(body, radius=int(size * 0.04), fill=(34, 36, 38), outline=(151, 103, 43), width=int(size * 0.008))
    for cx in (0.35, 0.65):
        x = int(size * cx)
        y = int(size * 0.50)
        r = int(size * 0.085)
        draw.ellipse((x-r, y-r, x+r, y+r), outline=(197, 137, 57), width=int(size * 0.012))
        draw.ellipse((x-r//3, y-r//3, x+r//3, y+r//3), fill=(12, 13, 14))
    draw.rounded_rectangle(
        (int(size * 0.43), int(size * 0.455), int(size * 0.57), int(size * 0.545)),
        radius=int(size * 0.012), fill=(9, 10, 11), outline=(107, 78, 38), width=int(size * 0.004)
    )

    # Default bitmap font keeps Pillow setup dependency-free.
    font = ImageFont.load_default()
    lines = ["GOOD BOY RECORDS", "ARTWORK PENDING"]
    ys = [int(size * 0.76), int(size * 0.80)]
    for text, y in zip(lines, ys):
        box = draw.textbbox((0, 0), text, font=font)
        w = box[2] - box[0]
        draw.text(((size-w)//2, y), text, font=font, fill=(198, 151, 82))
    return image


def write_derivatives(image: Image.Image, slug: str, output_dir: Path, anchor: float = 0.5) -> None:
    image = image.convert("RGB")
    cropped = square_crop(image, anchor)
    for size in SIZES:
        resized = cropped.resize((size, size), Image.LANCZOS)
        resized.save(output_dir / f"{slug}-{size}.webp", "WEBP", quality=82, method=6)
        resized.save(output_dir / f"{slug}-{size}.jpg", "JPEG", quality=84, optimize=True, progressive=True)


def main(source_dir: Path, output_dir: Path) -> int:
    masters = sorted(
        p for p in source_dir.iterdir() if p.suffix.lower() in {".png", ".jpg", ".jpeg", ".webp"}
    )
    output_dir.mkdir(parents=True, exist_ok=True)

    # Sleeve derivatives are generated build state. Remove old derivatives so
    # deleted/renamed showcase artwork cannot linger in the deployed site.
    for old in output_dir.iterdir():
        if old.is_file() and old.name != ".gitkeep" and old.suffix.lower() in {".jpg", ".jpeg", ".webp"}:
            old.unlink()

    # Always produce the built-in fallback first. This makes missing/broken cover
    # art a warning rather than a deployment blocker.
    write_derivatives(placeholder_image(), PLACEHOLDER_BASE, output_dir)
    print(f"{PLACEHOLDER_BASE}: built-in fallback -> 640 + 1280")

    if not masters:
        print(f"No sleeve masters found in {source_dir}; placeholder artwork only")
        return 0

    for master in masters:
        slug = master.stem
        anchor = ANCHORS.get(slug, DEFAULT_ANCHOR)
        try:
            with Image.open(master) as image:
                original_size = image.size
                write_derivatives(image, slug, output_dir, anchor)
            print(f"{slug}: {original_size[0]}x{original_size[1]} master, anchor {anchor} -> 640 + 1280")
        except Exception as exc:
            # A corrupt/unsupported individual cover should not stop the rest of
            # the curated showcase from publishing. build_catalogue.py will
            # substitute the built-in placeholder for this track.
            print(f"warn {master.name}: artwork processing failed ({exc}); placeholder will be used", file=sys.stderr)

    return 0


if __name__ == "__main__":
    args = sys.argv[1:]
    src = Path(args[0]) if args else Path("masters")
    dst = Path(args[1]) if len(args) > 1 else Path("assets/img/sleeves")
    raise SystemExit(main(src, dst))
