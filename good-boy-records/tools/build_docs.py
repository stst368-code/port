#!/usr/bin/env python3
"""Build the written half of the site from Markdown.

Reads `content-source/docs/<section>/*.md` and writes `/<section>/` and
`/<section>/<page>/`. Called by tools/build_catalogue.py, which owns the single
build command; this module only knows about prose.

Each file starts with YAML frontmatter:

    ---
    title: Working solution
    summary: What to install and run today.
    order: 1
    status: outline
    ---

`status: outline` marks a page that exists as a skeleton but has not been
written. It renders a visible notice and is flagged in the build output, so an
unfinished section announces itself rather than quietly looking finished.
"""

from __future__ import annotations

import re
import html
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

import yaml

ROOT = Path(__file__).resolve().parent.parent
DOCS_SOURCE = ROOT / "content-source" / "docs"
TEMPLATE_DIR = ROOT / "templates"

FRONTMATTER = re.compile(r"\A---\n(.*?)\n---\n", re.DOTALL)
VALID_STATUS = {"written", "outline"}

def _inline_markdown(text: str) -> str:
    """Small, dependency-free inline Markdown renderer.

    The site documentation deliberately uses a conservative Markdown subset.
    Keeping this here means a clean Windows checkout does not need the
    `markdown` or `mistune` packages merely to build the showcase.
    """
    placeholders: list[str] = []

    def stash(value: str) -> str:
        placeholders.append(value)
        return f"\x00{len(placeholders) - 1}\x00"

    # Preserve code spans before escaping ordinary text.
    text = re.sub(
        r"`([^`]+)`",
        lambda m: stash(f"<code>{html.escape(m.group(1), quote=False)}</code>"),
        text,
    )
    text = html.escape(text, quote=False)

    # Links are intentionally simple: [label](target).
    text = re.sub(
        r"\[([^\]]+)\]\(([^)]+)\)",
        lambda m: stash(
            f'<a href="{html.escape(html.unescape(m.group(2)), quote=True)}">'
            f'{html.escape(html.unescape(m.group(1)), quote=False)}</a>'
        ),
        text,
    )
    text = re.sub(r"\*\*([^*]+)\*\*", r"<strong>\1</strong>", text)
    text = re.sub(r"__([^_]+)__", r"<strong>\1</strong>", text)
    text = re.sub(r"(?<!\*)\*([^*]+)\*(?!\*)", r"<em>\1</em>", text)
    text = re.sub(r"(?<!_)_([^_]+)_(?!_)", r"<em>\1</em>", text)

    for i, value in enumerate(placeholders):
        text = text.replace(f"\x00{i}\x00", value)
    return text


def render_markdown(source: str) -> str:
    """Render the Markdown subset used by the documentation with stdlib only.

    Supports headings, paragraphs, links, emphasis, inline/fenced code,
    blockquotes, horizontal rules, ordered/unordered lists and simple tables.
    It is deliberately boring and deterministic, which is exactly what a
    static build tool should be.
    """
    lines = source.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out: list[str] = []
    paragraph: list[str] = []
    list_type: str | None = None
    in_code = False
    code_lang = ""
    code_lines: list[str] = []
    i = 0

    def flush_paragraph() -> None:
        nonlocal paragraph
        if paragraph:
            joined = " ".join(part.strip() for part in paragraph).strip()
            if joined:
                out.append(f"<p>{_inline_markdown(joined)}</p>")
            paragraph = []

    def close_list() -> None:
        nonlocal list_type
        if list_type:
            out.append(f"</{list_type}>")
            list_type = None

    while i < len(lines):
        raw = lines[i]
        stripped = raw.strip()

        if in_code:
            if stripped.startswith("```"):
                cls = f' class="language-{html.escape(code_lang, quote=True)}"' if code_lang else ""
                out.append(f"<pre><code{cls}>{html.escape(chr(10).join(code_lines), quote=False)}</code></pre>")
                in_code = False
                code_lang = ""
                code_lines = []
            else:
                code_lines.append(raw)
            i += 1
            continue

        if stripped.startswith("```"):
            flush_paragraph()
            close_list()
            in_code = True
            code_lang = stripped[3:].strip()
            i += 1
            continue

        if not stripped:
            flush_paragraph()
            close_list()
            i += 1
            continue

        # Simple pipe tables. A table begins with a row followed by a separator.
        if "|" in stripped and i + 1 < len(lines):
            separator = lines[i + 1].strip()
            if re.match(r"^\|?\s*:?-{3,}:?\s*(?:\|\s*:?-{3,}:?\s*)+\|?$", separator):
                flush_paragraph()
                close_list()
                headers = [c.strip() for c in stripped.strip("|").split("|")]
                out.append("<table><thead><tr>" + "".join(f"<th>{_inline_markdown(c)}</th>" for c in headers) + "</tr></thead><tbody>")
                i += 2
                while i < len(lines) and "|" in lines[i] and lines[i].strip():
                    cells = [c.strip() for c in lines[i].strip().strip("|").split("|")]
                    out.append("<tr>" + "".join(f"<td>{_inline_markdown(c)}</td>" for c in cells) + "</tr>")
                    i += 1
                out.append("</tbody></table>")
                continue

        heading = re.match(r"^(#{1,6})\s+(.+?)\s*$", stripped)
        if heading:
            flush_paragraph()
            close_list()
            level = len(heading.group(1))
            title = heading.group(2)
            slug = re.sub(r"[^a-z0-9]+", "-", re.sub(r"<[^>]+>", "", title).lower()).strip("-")
            attr = f' id="{slug}"' if slug else ""
            out.append(f"<h{level}{attr}>{_inline_markdown(title)}</h{level}>")
            i += 1
            continue

        if re.match(r"^(?:---+|___+|\*\*\*+)$", stripped):
            flush_paragraph()
            close_list()
            out.append("<hr>")
            i += 1
            continue

        quote = re.match(r"^>\s?(.*)$", stripped)
        if quote:
            flush_paragraph()
            close_list()
            quoted: list[str] = []
            while i < len(lines):
                q = re.match(r"^\s*>\s?(.*)$", lines[i])
                if not q:
                    break
                quoted.append(q.group(1))
                i += 1
            out.append(f"<blockquote><p>{_inline_markdown(' '.join(quoted))}</p></blockquote>")
            continue

        bullet = re.match(r"^[-+*]\s+(.+)$", stripped)
        ordered = re.match(r"^\d+[.)]\s+(.+)$", stripped)
        if bullet or ordered:
            flush_paragraph()
            wanted = "ul" if bullet else "ol"
            if list_type != wanted:
                close_list()
                list_type = wanted
                out.append(f"<{wanted}>")
            item = bullet.group(1) if bullet else ordered.group(1)
            out.append(f"<li>{_inline_markdown(item)}</li>")
            i += 1
            continue

        paragraph.append(stripped)
        i += 1

    if in_code:
        cls = f' class="language-{html.escape(code_lang, quote=True)}"' if code_lang else ""
        out.append(f"<pre><code{cls}>{html.escape(chr(10).join(code_lines), quote=False)}</code></pre>")
    flush_paragraph()
    close_list()
    return "\n".join(out)


@dataclass
class Page:
    slug: str
    title: str
    summary: str
    status: str
    body: str
    order: int = 100
    updated: str | None = None


@dataclass
class Section:
    slug: str
    index: Page
    pages: list[Page] = field(default_factory=list)

    @property
    def order(self) -> int:
        return self.index.order

    @property
    def title(self) -> str:
        return self.index.title


def read_page(path: Path, report: Any) -> Page | None:
    where = str(path.relative_to(ROOT))
    text = path.read_text(encoding="utf-8")

    match = FRONTMATTER.match(text)
    if not match:
        report.error(where, "has no YAML frontmatter block")
        return None

    try:
        meta = yaml.safe_load(match.group(1)) or {}
    except yaml.YAMLError as exc:
        report.error(where, f"has invalid frontmatter — {exc}")
        return None

    if not meta.get("title"):
        report.error(where, "frontmatter has no title")
        return None

    status = meta.get("status", "written")
    if status not in VALID_STATUS:
        report.error(where, f"status must be one of {sorted(VALID_STATUS)}, found {status!r}")
        return None
    if status == "outline":
        report.warn(where, "is still an outline")

    body = render_markdown(text[match.end():])

    return Page(
        slug=path.stem,
        title=str(meta["title"]),
        summary=str(meta.get("summary") or ""),
        status=status,
        body=body,
        order=int(meta.get("order") or 100),
        updated=str(meta["updated"]) if meta.get("updated") else None,
    )


def discover(report: Any) -> list[Section]:
    if not DOCS_SOURCE.exists():
        return []

    sections: list[Section] = []
    for directory in sorted(p for p in DOCS_SOURCE.iterdir() if p.is_dir()):
        index_path = directory / "index.md"
        if not index_path.exists():
            report.error(str(directory.relative_to(ROOT)), "has no index.md")
            continue

        index = read_page(index_path, report)
        if index is None:
            continue

        pages = []
        for path in sorted(directory.glob("*.md")):
            if path.name == "index.md":
                continue
            page = read_page(path, report)
            if page is not None:
                pages.append(page)
        pages.sort(key=lambda item: (item.order, item.title))

        sections.append(Section(slug=directory.name, index=index, pages=pages))

    sections.sort(key=lambda item: (item.order, item.title))
    return sections


def nav_html(sections: list[Section], root: str, current: str | None = None) -> str:
    """One navigation, generated once, identical on every page."""
    if not sections:
        return ""
    items = []
    for section in sections:
        mark = ' aria-current="page"' if current == section.slug else ""
        items.append(f'<li><a href="{root}{section.slug}/"{mark}>{section.title}</a></li>')
    return '<nav class="nav" aria-label="Sections"><ul>' + "".join(items) + "</ul></nav>"


def status_notice(page: Page) -> str:
    if page.status != "outline":
        return ""
    return (
        '<p class="notice">This is an outline. The headings below are what belongs '
        "here; none of it has been written up yet.</p>"
    )


def build(sections: list[Section], render: Any, report: Any) -> int:
    """Write every section and page. `render` is the token substituter from
    build_catalogue, so both halves of the site share one template engine."""
    if not sections:
        return 0

    template = (TEMPLATE_DIR / "doc.html").read_text(encoding="utf-8")
    written = 0

    for section in sections:
        children = ""
        if section.pages:
            rows = "".join(
                '<li><a href="{slug}/">{title}</a>{summary}{flag}</li>'.format(
                    slug=page.slug,
                    title=page.title,
                    summary=f" — {page.summary}" if page.summary else "",
                    flag=' <span class="flag">outline</span>' if page.status == "outline" else "",
                )
                for page in section.pages
            )
            children = f'<h2 class="detail__heading">In this section</h2><ul class="childList">{rows}</ul>'

        directory = ROOT / section.slug
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "index.html").write_text(
            render(
                template,
                {
                    "ROOT": "../",
                    "NAV": nav_html(sections, "../", section.slug),
                    "TITLE": section.index.title,
                    "EYEBROW": section.index.summary or "Notes",
                    "UPDATED": f" · Updated {section.index.updated}" if section.index.updated else "",
                    "STATUS": status_notice(section.index),
                    "BODY": section.index.body,
                    "CHILDREN": children,
                    "PARENT": "",
                    "YEAR": str(date.today().year),
                },
            ),
            encoding="utf-8",
        )
        written += 1

        for page in section.pages:
            page_dir = directory / page.slug
            page_dir.mkdir(parents=True, exist_ok=True)
            (page_dir / "index.html").write_text(
                render(
                    template,
                    {
                        "ROOT": "../../",
                        "NAV": nav_html(sections, "../../", section.slug),
                        "TITLE": page.title,
                        "EYEBROW": section.index.title,
                        "UPDATED": f" · Updated {page.updated}" if page.updated else "",
                        "STATUS": status_notice(page),
                        "BODY": page.body,
                        "CHILDREN": "",
                        "PARENT": f'<p class="detail__back"><a href="../">Back to {section.index.title}</a></p>',
                        "YEAR": str(date.today().year),
                    },
                ),
                encoding="utf-8",
            )
            written += 1

    return written
