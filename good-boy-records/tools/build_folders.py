#!/usr/bin/env python3
"""Build the side folder tabs from `content-source/folders/*.md`.

Each file is one tab. Frontmatter:

    ---
    tab: Notes            # short label on the tab itself, keep it to ~12 chars
    title: Production notes
    order: 1
    ---

    Body markdown here.

Ordering is by `order`, then filename. Files with no frontmatter are skipped
with a warning rather than failing the build, so a half-written note cannot
break the site. If the directory is missing or empty, no tabs are emitted and
the player renders exactly as it did before the feature existed.

Markdown goes through `build_docs.render_markdown`, the same conservative
dependency-free subset the written pages use.
"""
from __future__ import annotations

import html
import re
from pathlib import Path

import yaml

import build_docs

ROOT = Path(__file__).resolve().parent.parent
FOLDERS_SOURCE = ROOT / "content-source" / "folders"

SLUG_SAFE = re.compile(r"[^a-z0-9]+")
# Files are usually named 01-about.md so they sort; the ordering prefix
# should not end up in the element id.
ORDER_PREFIX = re.compile(r"^\d+[-_]")


def slug(value: str) -> str:
    value = ORDER_PREFIX.sub("", value.strip())
    return SLUG_SAFE.sub("-", value.lower()).strip("-") or "note"


def read_folder(path: Path, warn) -> dict | None:
    text = path.read_text(encoding="utf-8")
    match = build_docs.FRONTMATTER.match(text)
    if not match:
        warn(f"folders: {path.name} has no frontmatter, skipped")
        return None
    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as error:
        warn(f"folders: {path.name} frontmatter is not valid YAML ({error}), skipped")
        return None

    title = str(meta.get("title") or path.stem.replace("-", " ").title())
    tab = str(meta.get("tab") or title)
    return {
        "id": slug(str(meta.get("slug") or path.stem)),
        "tab": tab,
        "title": title,
        "order": meta.get("order", 999),
        "body": build_docs.render_markdown(text[match.end():]),
    }


def discover(warn=print) -> list[dict]:
    if not FOLDERS_SOURCE.is_dir():
        return []
    found = []
    for path in sorted(FOLDERS_SOURCE.glob("*.md")):
        folder = read_folder(path, warn)
        if folder:
            found.append(folder)
    found.sort(key=lambda f: (f["order"] if isinstance(f["order"], int) else 999, f["tab"]))
    return found


def render(folders: list[dict]) -> str:
    if not folders:
        return ""

    tabs = []
    sheets = []
    for folder in folders:
        fid = folder["id"]
        tabs.append(
            f'<button class="gbr-folder-tab" type="button" role="tab"'
            f' id="gbr-tab-{fid}" data-folder="{fid}"'
            f' aria-controls="gbr-folder-{fid}" aria-selected="false">'
            f'<span>{html.escape(folder["tab"])}</span></button>'
        )
        sheets.append(
            f'<article class="gbr-folder-sheet" role="tabpanel" id="gbr-folder-{fid}"'
            f' aria-labelledby="gbr-tab-{fid}" tabindex="-1" hidden>'
            f'<h2 class="gbr-folder-title">{html.escape(folder["title"])}</h2>'
            f'<div class="gbr-folder-body">{folder["body"]}</div>'
            f"</article>"
        )

    return (
        '<aside class="gbr-folders" id="gbr-folders" data-open="">\n'
        '  <div class="gbr-folder-scrim" id="gbr-folder-scrim"></div>\n'
        '  <div class="gbr-folder-tabs" role="tablist" aria-label="Sleeve notes">\n    '
        + "\n    ".join(tabs)
        + '\n  </div>\n'
        '  <div class="gbr-folder-drawer" id="gbr-folder-drawer">\n'
        '    <button class="gbr-folder-close" type="button" id="gbr-folder-close"'
        ' aria-label="Close notes">&times;</button>\n    '
        + "\n    ".join(sheets)
        + "\n  </div>\n</aside>"
    )


def build(warn=print) -> str:
    return render(discover(warn))


if __name__ == "__main__":
    found = discover()
    print(f"{len(found)} folder(s): " + ", ".join(f["tab"] for f in found))
