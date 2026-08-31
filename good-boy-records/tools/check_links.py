#!/usr/bin/env python3
"""Walk the built HTML and confirm every local link and asset actually exists.

A dead sleeve or a link to a page that was never written is the kind of thing
that survives review and embarrasses you later, so it fails the build instead.

    python tools/check_links.py
"""

from __future__ import annotations

import re
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
REFERENCE = re.compile(r'(?:href|src|srcset)="([^"]+)"')

SKIP_SCHEMES = {"http", "https", "mailto", "tel", "data", "javascript"}

# Sources, not output. templates/index.html is full of unresolved tokens.
SKIP_DIRS = {"templates", "content-source", "docs-source", "masters", "tools", "_site"}


def candidates(page: Path, target: str) -> list[Path]:
    """Where a browser would look for this reference."""
    base = (page.parent / target).resolve()
    if target.endswith("/") or base.is_dir():
        return [base / "index.html"]
    return [base]


def main() -> int:
    pages = sorted(
        path
        for path in ROOT.rglob("*.html")
        if not SKIP_DIRS.intersection(path.relative_to(ROOT).parts)
    )
    if not pages:
        print("No built pages found. Run tools/build_catalogue.py first.", file=sys.stderr)
        return 1

    broken: list[str] = []
    checked = 0

    for page in pages:
        html = page.read_text(encoding="utf-8")
        for raw in REFERENCE.findall(html):
            # srcset carries several candidates with width descriptors.
            for part in raw.split(","):
                target = unquote(part.strip().split(" ")[0])
                if not target or target.startswith("#"):
                    continue
                if urlparse(target).scheme in SKIP_SCHEMES:
                    continue
                target = target.split("#")[0].split("?")[0]
                if not target:
                    continue
                checked += 1
                if not any(path.exists() for path in candidates(page, target)):
                    broken.append(f"{page.relative_to(ROOT)} -> {target}")

    for item in sorted(set(broken)):
        print(f"  MISSING  {item}", file=sys.stderr)

    print(f"Checked {checked} references across {len(pages)} pages")
    if broken:
        print(f"{len(set(broken))} broken reference(s).", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
