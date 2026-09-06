#!/usr/bin/env python3
"""Sync media referenced by read-only ComfyUI workflows into public assets.

Authoring locations (source of truth):
    content-source/images/       images, GIFs and video examples
    content-source/otheraudio/   audio examples

Generated runtime locations:
    assets/workflow-media/images/
    assets/workflow-media/audio/

Workflow JSON keeps the ordinary ComfyUI filename only.  During a build we
scan every workflow, validate that each referenced media file exists with the
same case, then copy the source folders into assets so local preview and
GitHub Pages use the exact same URLs.
"""
from __future__ import annotations

import json
import shutil
from pathlib import Path, PurePosixPath
from typing import Any, Iterable

ROOT = Path(__file__).resolve().parent.parent
WORKFLOW_DIR = ROOT / "assets" / "workflows"
VISUAL_SOURCE = ROOT / "content-source" / "images"
AUDIO_SOURCE = ROOT / "content-source" / "otheraudio"
PUBLIC_ROOT = ROOT / "assets" / "workflow-media"
VISUAL_OUT = PUBLIC_ROOT / "images"
AUDIO_OUT = PUBLIC_ROOT / "audio"

IMAGE_EXTENSIONS = {".png", ".jpg", ".jpeg", ".webp", ".gif", ".svg", ".avif"}
VIDEO_EXTENSIONS = {".mp4", ".webm", ".mov", ".m4v", ".ogv"}
AUDIO_EXTENSIONS = {".mp3", ".flac", ".wav", ".ogg", ".oga", ".m4a", ".aac", ".opus"}
VISUAL_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS


def _safe_relative(value: str) -> str | None:
    """Return a portable relative media path, rejecting traversal/absolute refs."""
    cleaned = str(value or "").strip().replace("\\", "/")
    if not cleaned:
        return None
    path = PurePosixPath(cleaned)
    if path.is_absolute() or any(part in {"", ".", ".."} for part in path.parts):
        return None
    return path.as_posix()


def _all_nodes(workflow: dict[str, Any]) -> Iterable[dict[str, Any]]:
    for node in workflow.get("nodes") or []:
        if isinstance(node, dict):
            yield node
    definitions = workflow.get("definitions") or {}
    for graph in definitions.get("subgraphs") or []:
        if not isinstance(graph, dict):
            continue
        for node in graph.get("nodes") or []:
            if isinstance(node, dict):
                yield node


def _candidate_values(node: dict[str, Any]) -> Iterable[str]:
    named = node.get("widgets_values_named")
    if isinstance(named, dict):
        # These are the fields ComfyUI currently uses for its media loaders and
        # for collapsed subgraph preview nodes.
        for key in ("image", "file", "audio"):
            value = named.get(key)
            if isinstance(value, str):
                yield value

    # Older/custom nodes may not expose the named mapping. Only accept values
    # which actually look like media, so prompt text is never mistaken for a file.
    values = node.get("widgets_values")
    if isinstance(values, list):
        for value in values:
            if isinstance(value, str):
                yield value


def media_references(workflow: dict[str, Any]) -> set[tuple[str, str]]:
    refs: set[tuple[str, str]] = set()
    for node in _all_nodes(workflow):
        for raw in _candidate_values(node):
            relative = _safe_relative(raw)
            if not relative:
                continue
            suffix = PurePosixPath(relative).suffix.lower()
            if suffix in AUDIO_EXTENSIONS:
                refs.add(("audio", relative))
            elif suffix in VISUAL_EXTENSIONS:
                refs.add(("images", relative))
    return refs


def _inventory(folder: Path) -> set[str]:
    if not folder.is_dir():
        return set()
    return {
        path.relative_to(folder).as_posix()
        for path in folder.rglob("*")
        if path.is_file() and path.name != ".gitkeep"
    }


def _copy_source(source: Path, destination: Path) -> int:
    if destination.exists():
        shutil.rmtree(destination)
    destination.mkdir(parents=True, exist_ok=True)
    if not source.is_dir():
        return 0
    count = 0
    for path in source.rglob("*"):
        if not path.is_file() or path.name == ".gitkeep":
            continue
        relative = path.relative_to(source)
        target = destination / relative
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
        count += 1
    return count


def sync(report) -> None:
    """Validate workflow references and rebuild public workflow-media assets."""
    visual_files = _inventory(VISUAL_SOURCE)
    audio_files = _inventory(AUDIO_SOURCE)
    expected = {"images": visual_files, "audio": audio_files}

    workflow_refs: list[tuple[Path, str, str]] = []
    if WORKFLOW_DIR.is_dir():
        for path in sorted(WORKFLOW_DIR.glob("*.json")):
            try:
                workflow = json.loads(path.read_text(encoding="utf-8"))
            except (OSError, json.JSONDecodeError) as exc:
                report.error(str(path.relative_to(ROOT)), f"cannot parse workflow JSON — {exc}")
                continue
            if not isinstance(workflow, dict):
                report.error(str(path.relative_to(ROOT)), "workflow root is not a JSON object")
                continue
            for kind, relative in sorted(media_references(workflow)):
                workflow_refs.append((path, kind, relative))

    for workflow_path, kind, relative in workflow_refs:
        # Inventory comparison is deliberately case-sensitive even on Windows.
        # GitHub Pages builds on Linux, where Foo.PNG and foo.png are different.
        if relative not in expected[kind]:
            source_name = "content-source/images" if kind == "images" else "content-source/otheraudio"
            report.error(
                str(workflow_path.relative_to(ROOT)),
                f"references '{relative}' but '{source_name}/{relative}' does not exist with exactly that spelling/case",
            )

    visual_count = _copy_source(VISUAL_SOURCE, VISUAL_OUT)
    audio_count = _copy_source(AUDIO_SOURCE, AUDIO_OUT)
    print(
        f"Workflow media: {visual_count} visual file(s), {audio_count} audio file(s), "
        f"{len(workflow_refs)} referenced asset(s) checked"
    )
