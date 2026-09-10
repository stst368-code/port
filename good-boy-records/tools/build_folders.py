#!/usr/bin/env python3
"""Build the Good Boy Records pull-down page drawer from Markdown.

Each file under `content-source/folders/*.md` is one page. Frontmatter:

    ---
    tab: About
    title: About Good Boy Records
    order: 1
    ---

`tab` is the short engraved label on the top rail. `order` controls its
left-to-right position. The rail scrolls horizontally when the page count
outgrows the viewport, so adding the intended ~10 pages requires no template
changes.

Markdown is rendered by `build_docs.render_markdown`, including GBR's Spotify,
Microsoft Forms and read-only ComfyUI workflow directives.
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
    order = meta.get("order", 999)
    return {
        "id": slug(str(meta.get("slug") or path.stem)),
        "tab": tab,
        "title": title,
        "order": order,
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
        order = folder["order"] if isinstance(folder["order"], int) else 999
        order_label = f"{order:02d}" if 0 <= order <= 99 else str(order)
        tabs.append(
            f'<button class="gbr-folder-tab" type="button" role="tab"'
            f' id="gbr-tab-{fid}" data-folder="{fid}" data-order="{html.escape(order_label)}"'
            f' title="{html.escape(folder["title"], quote=True)}"'
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
        '  <div class="gbr-folder-tabs" role="tablist" aria-orientation="horizontal"'
        ' aria-label="Good Boy Records pages">\n    '
        + "\n    ".join(tabs)
        + '\n  </div>\n'
        '  <div class="gbr-folder-scrim" id="gbr-folder-scrim"></div>\n'
        '  <section class="gbr-folder-drawer" id="gbr-folder-drawer"'
        ' aria-label="Good Boy Records page drawer">\n'
        '    <div class="gbr-folder-drawer-cap" aria-hidden="true">'
        '<span>GOOD BOY RECORDS / INFORMATION RACK</span></div>\n'
        '    <button class="gbr-folder-close" type="button" id="gbr-folder-close"'
        ' aria-label="Retract page drawer">RETRACT</button>\n    '
        + "\n    ".join(sheets)
        + '\n    <div class="gbr-folder-resizer" id="gbr-folder-resizer" role="separator" tabindex="0"'
        ' aria-orientation="horizontal" aria-label="Resize page drawer height"'
        ' title="Drag to resize; double-click to reset"></div>\n'
        "  </section>\n"
        "</aside>"
    )


def build(warn=print) -> str:
    return render(discover(warn))


if __name__ == "__main__":
    found = discover()
    print(f"{len(found)} page(s): " + ", ".join(f["tab"] for f in found))
