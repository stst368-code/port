#!/usr/bin/env python3
"""Stage only runtime files for GitHub Pages, including repository-hosted audio."""
from __future__ import annotations
import shutil
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "_site"
LIMIT = 1024 ** 3  # GitHub Pages published-site limit: 1 GiB planning guard.


def copy_item(source: Path) -> None:
    target = OUT / source.relative_to(ROOT)
    if source.is_dir():
        shutil.copytree(source, target, dirs_exist_ok=True)
    elif source.exists():
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, target)


def main() -> int:
    if OUT.exists():
        shutil.rmtree(OUT)
    OUT.mkdir()
    for name in ["index.html", "assets", "data", "music"]:
        copy_item(ROOT / name)
    docs = ROOT / "content-source" / "docs"
    if docs.exists():
        for section in sorted(p for p in docs.iterdir() if p.is_dir()):
            copy_item(ROOT / section.name)

    files = [p for p in OUT.rglob("*") if p.is_file()]
    too_large = [p for p in files if p.stat().st_size >= 100 * 1024 * 1024]
    if too_large:
        print("Files at/over GitHub's normal 100 MiB file limit:")
        for path in too_large:
            print("  ", path.relative_to(OUT))
        return 1

    total = sum(p.stat().st_size for p in files)
    print(f"Staged {len(files)} runtime files: {total / (1024**2):.1f} MiB / 1024 MiB")
    if total >= LIMIT:
        print("Published site is at/over 1 GiB; trim audio or other runtime assets before deployment.")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
