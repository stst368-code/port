#!/usr/bin/env python3
"""Render a throwaway demo build so the layout can be eyeballed without media.

Writes `_demo/` only. Nothing here touches the real catalogue, and the module
is never imported by the site build. Run it, look at it, delete it.

    python tools/make_demo.py
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from build_catalogue import grouped_shelf, render  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_demo"

SONGS = [
    ("Paws Off The Velvet", "soul-funk", ["1", "2", "3"], (86, 24, 46)),
    ("Gimmie Gimmie Ball", "northern soul", ["1", "2"], (196, 108, 24)),
    ("Sixteen Treats", "country swing", ["1", "2", "3", "4"], (140, 92, 30)),
    ("New Mills, New Mills", "western swing", ["1"], (48, 78, 96)),
    ("Doja Took The Chair", "slow blues", ["1", "2"], (112, 40, 88)),
    ("Tennis Ball Rhapsody", "psych rock", ["1", "2", "3"], (58, 104, 62)),
    ("Who's A Good Boy", "disco", ["1", "2"], (176, 60, 32)),
    ("Bam Bam Boogie", "boogie-woogie", ["1", "2", "3"], (30, 84, 110)),
]


def sleeve(path: Path, rgb: tuple[int, int, int], text: str) -> None:
    """Flat two-tone sleeve. Enough to tell tapes apart in a screenshot."""
    from PIL import Image, ImageDraw

    size = 640
    img = Image.new("RGB", (size, size), rgb)
    draw = ImageDraw.Draw(img)
    warm = tuple(min(255, int(c * 1.5) + 30) for c in rgb)
    draw.ellipse((size * 0.12, size * 0.1, size * 0.88, size * 0.72), fill=warm)
    draw.rectangle((0, size * 0.78, size, size), fill=tuple(int(c * 0.45) for c in rgb))
    draw.text((size * 0.06, size * 0.84), text[:22], fill=(240, 226, 196))
    img.save(path, quality=88)


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    (OUT / "assets/img/sleeves").mkdir(parents=True)
    (OUT / "assets/css").mkdir(parents=True)
    (OUT / "assets/js").mkdir(parents=True)

    shutil.copy2(ROOT / "assets/css/v7.css", OUT / "assets/css/v7.css")
    shutil.copy2(ROOT / "assets/js/v7.js", OUT / "assets/js/v7.js")
    for placeholder in (ROOT / "assets/img/sleeves").glob("gbr-placeholder-*"):
        shutil.copy2(placeholder, OUT / "assets/img/sleeves" / placeholder.name)

    tracks: list[dict] = []
    for song_index, (title, genre, versions, rgb) in enumerate(SONGS):
        composition = title.lower().replace(" ", "-").replace(",", "").replace("'", "")
        for version in versions:
            track_id = f"{composition}-v{version}"
            base = f"sleeve-{song_index}"
            for width in (640, 1280):
                for ext in ("jpg", "webp"):
                    target = OUT / f"assets/img/sleeves/{base}-{width}.{ext}"
                    if not target.exists():
                        sleeve(target, rgb, title)
            tracks.append({
                "id": track_id,
                "composition": composition,
                "versionLabel": f"v{version}",
                "slug": track_id,
                "title": title,
                "subtitle": f"{genre} · generated take {version}",
                "catalogueNumber": f"GBR-{song_index + 1:03d}",
                "model": {"provider": "ACE-Step", "name": "3.5B"},
                "provenance": {"songVersion": version, "generationNumber": int(version)},
                "generation": {"cfg": 4.5, "steps": 60, "seed": 100000 + song_index},
                "style": {"genre": genre, "summary": genre},
                "audio": {
                    "available": True,
                    "duration": 180 + song_index * 11,
                    "sources": {"mp3": f"{track_id}.mp3"},
                },
                "artwork": {"base": base, "alt": f"{title} sleeve"},
                "links": {}, "prompt": {}, "notes": {"short": f"A {genre} number."},
                "aiGenerated": True,
                "lyrics": {"synchronisation": "line", "cues": []},
            })

    shelf = grouped_shelf(tracks)
    template = (ROOT / "templates/index.html").read_text(encoding="utf-8")
    (OUT / "index.html").write_text(
        render(template, {
            "ROOT": "",
            "SHELF": shelf,
            "CATALOGUE_JSON": json.dumps(tracks, separators=(",", ":")).replace("</", "<\\/"),
            "TRACK_COUNT": str(len(tracks)),
            "NAV": "",
            "YEAR": "2026",
        }),
        encoding="utf-8",
    )
    print(f"demo: {len(tracks)} tapes across {len(SONGS)} songs -> {OUT}/index.html")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
