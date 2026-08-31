#!/usr/bin/env python3
"""Build the Good Boy Records site from its content sources.

Reads:
    content-source/tracks/*.yaml    one file per released track
    content-source/lyrics/*.lrc     one file per track, hand-timed
    templates/*.html                page shells with {{TOKEN}} slots

Writes:
    data/catalogue.json             the validated catalogue
    data/lyrics/<id>.json           normalised cues, end times calculated
    data/lyrics/<id>.vtt            the same cues as WebVTT
    index.html                      shelf, deck and liner notes
    music/<slug>/index.html         one permanent page per track

A malformed track should break the build, not the site. Anything that would
leave a visitor with a dead play button is an error; anything that only leaves
the record incomplete is a warning.

    python tools/build_catalogue.py
    python tools/build_catalogue.py --strict   # warnings become errors
"""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
import sys
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))

try:
    import yaml
except ImportError:  # pragma: no cover
    sys.exit("PyYAML is required: pip install PyYAML")

import build_docs

ROOT = Path(__file__).resolve().parent.parent

TRACK_DIR = ROOT / "content-source" / "tracks"
LYRIC_DIR = ROOT / "content-source" / "lyrics"
TEMPLATE_DIR = ROOT / "templates"
DATA_DIR = ROOT / "data"
LYRIC_OUT_DIR = DATA_DIR / "lyrics"
MUSIC_DIR = ROOT / "music"
SLEEVE_DIR = ROOT / "assets" / "img" / "sleeves"
TRACK_AUDIO_DIR = ROOT / "assets" / "audio" / "tracks"
PREVIEW_AUDIO_DIR = ROOT / "assets" / "audio" / "previews"

SLEEVE_WIDTHS = (640, 1280)
LRC_LINE = re.compile(r"^((?:\[\d{1,3}:\d{2}(?:[.:]\d{1,3})?\])+)(.*)$")
LRC_STAMP = re.compile(r"\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]")
LRC_META = re.compile(r"^\[([a-z]{2,}):(.*)\]$", re.IGNORECASE)


# --------------------------------------------------------------------------
# Reporting


@dataclass
class Report:
    errors: list[str] = field(default_factory=list)
    warnings: list[str] = field(default_factory=list)

    def error(self, where: str, message: str) -> None:
        self.errors.append(f"{where}: {message}")

    def warn(self, where: str, message: str) -> None:
        self.warnings.append(f"{where}: {message}")

    def summarise(self, strict: bool) -> int:
        for warning in self.warnings:
            print(f"  warn   {warning}")
        for error in self.errors:
            print(f"  ERROR  {error}", file=sys.stderr)
        if self.errors:
            print(f"\nBuild failed: {len(self.errors)} error(s).", file=sys.stderr)
            return 1
        if self.warnings and strict:
            print(f"\nBuild failed: {len(self.warnings)} warning(s) under --strict.", file=sys.stderr)
            return 1
        return 0


# --------------------------------------------------------------------------
# Lyrics


def parse_lrc(path: Path, duration: float | None, report: Report) -> list[dict[str, Any]]:
    """Turn an LRC file into ordered cues with start and end times.

    A timestamp with no text is a gap marker: it closes the line before it and
    produces nothing of its own. That is how the silence between verses gets
    represented without inventing an empty lyric line.
    """
    where = path.name
    stamps: list[tuple[float, str]] = []

    for number, raw in enumerate(path.read_text(encoding="utf-8").splitlines(), start=1):
        line = raw.strip()
        if not line:
            continue
        if LRC_META.match(line) and not LRC_STAMP.match(line):
            continue  # [ti:] [ar:] [by:] and friends

        match = LRC_LINE.match(line)
        if not match:
            report.error(where, f"line {number} is not a timestamped lyric or a metadata tag")
            continue

        text = match.group(2).strip()
        for stamp in LRC_STAMP.finditer(match.group(1)):
            minutes, seconds, fraction = stamp.groups()
            hundredths = 0.0
            if fraction:
                hundredths = int(fraction) / (10 ** len(fraction))
            stamps.append((int(minutes) * 60 + int(seconds) + hundredths, text))

    if not stamps:
        report.error(where, "contains no timed lines")
        return []

    stamps.sort(key=lambda item: item[0])

    cues: list[dict[str, Any]] = []
    previous_time = -1.0
    for start, text in stamps:
        if start == previous_time:
            report.warn(where, f"two lines share the timestamp {format_clock(start)}")
        previous_time = start
        if not text:
            if cues:
                cues[-1]["end"] = start
            continue
        if cues and cues[-1]["end"] is None:
            cues[-1]["end"] = start
        cues.append({"id": f"l{len(cues) + 1}", "start": round(start, 3), "end": None, "text": text})

    if cues and cues[-1]["end"] is None:
        tail = duration if duration else cues[-1]["start"] + 6
        cues[-1]["end"] = round(max(tail, cues[-1]["start"] + 1), 3)

    for cue in cues:
        cue["end"] = round(float(cue["end"]), 3)
        if cue["end"] <= cue["start"]:
            report.error(where, f"cue {cue['id']} ends before it starts")

    if duration and cues and cues[-1]["end"] > duration + 1:
        report.warn(where, f"last cue ends at {format_clock(cues[-1]['end'])}, past the stated duration")

    return cues


def cues_to_vtt(cues: list[dict[str, Any]]) -> str:
    lines = ["WEBVTT", ""]
    for cue in cues:
        lines.append(cue["id"])
        lines.append(f"{format_vtt(cue['start'])} --> {format_vtt(cue['end'])}")
        lines.append(cue["text"])
        lines.append("")
    return "\n".join(lines)


def format_vtt(seconds: float) -> str:
    whole = int(seconds)
    milliseconds = round((seconds - whole) * 1000)
    return f"{whole // 3600:02d}:{whole % 3600 // 60:02d}:{whole % 60:02d}.{milliseconds:03d}"


def format_clock(seconds: float | None) -> str:
    if not seconds:
        return "--:--"
    total = int(round(seconds))
    return f"{total // 60}:{total % 60:02d}"


# --------------------------------------------------------------------------
# Track loading and validation


def load_tracks(report: Report) -> list[dict[str, Any]]:
    files = sorted(TRACK_DIR.rglob("*.yaml"))
    if not files:
        report.error("content-source/tracks", "no track definitions found")
        return []

    tracks: list[dict[str, Any]] = []
    seen_ids: dict[str, str] = {}

    for path in files:
        where = path.name
        try:
            raw = yaml.safe_load(path.read_text(encoding="utf-8")) or {}
        except yaml.YAMLError as exc:
            report.error(where, f"is not valid YAML — {exc}")
            continue
        if not isinstance(raw, dict):
            report.error(where, "should contain a single mapping of fields")
            continue

        track_id = raw.get("id")
        if not track_id:
            report.error(where, "has no id")
            continue
        if track_id in seen_ids:
            report.error(where, f"reuses the id '{track_id}', already taken by {seen_ids[track_id]}")
            continue
        seen_ids[track_id] = where

        if not raw.get("title"):
            report.error(where, "has no title")
        if raw.get("aiGenerated") is None:
            report.error(where, "must state aiGenerated: true or false")

        raw.setdefault("slug", track_id)
        raw.setdefault("catalogueNumber", None)
        for section in ("model", "provenance", "generation", "style", "audio", "lyrics", "artwork", "prompt", "links", "notes"):
            if not isinstance(raw.get(section), dict):
                raw[section] = {}

        validate_artwork(raw, where, report)
        validate_audio(raw, where, report)
        attach_lyrics(raw, where, report)
        validate_generation(raw, where, report)

        tracks.append(raw)

    def sort_key(item: dict[str, Any]) -> tuple[Any, ...]:
        style = item.get("style") or {}
        genre = str(style.get("genre") or "Unclassified").casefold()
        composition = str(item.get("composition") or item.get("title") or item.get("id") or "").casefold()
        version = (item.get("provenance") or {}).get("songVersion")
        try:
            version_key = (0, float(version))
        except (TypeError, ValueError):
            version_key = (1, str(version or "").casefold())
        generation = item.get("generation") or {}
        steps = generation.get("steps")
        try:
            steps_key = float(steps)
        except (TypeError, ValueError):
            steps_key = -1
        return (genre, composition, version_key, steps_key, str(item.get("id") or "").casefold())

    tracks.sort(key=sort_key)

    # A composition should normally live in one genre so every version remains
    # together. Warn rather than silently rewriting the user's YAML.
    composition_genres: dict[str, set[str]] = {}
    for item in tracks:
        composition = str(item.get("composition") or item.get("id") or "")
        genre = str((item.get("style") or {}).get("genre") or "Unclassified")
        composition_genres.setdefault(composition, set()).add(genre)
    for composition, genres in composition_genres.items():
        if len(genres) > 1:
            report.warn(composition, "versions declare different genres: " + ", ".join(sorted(genres)))
    return tracks


def validate_artwork(track: dict[str, Any], where: str, report: Report) -> None:
    base = track["artwork"].get("base")
    if not base:
        report.error(where, "has no artwork.base")
        return
    missing = [
        f"{base}-{width}.{extension}"
        for width in SLEEVE_WIDTHS
        for extension in ("webp", "jpg")
        if not (SLEEVE_DIR / f"{base}-{width}.{extension}").exists()
    ]
    if missing:
        report.error(where, f"artwork derivatives missing: {', '.join(missing)} — run tools/prepare_artwork.py")
    if not track["artwork"].get("alt"):
        report.error(where, "artwork has no alt description")


def is_remote_media(value: str | None) -> bool:
    return bool(value and re.match(r"^(?:https?:)?//", str(value), re.IGNORECASE))


def media_url(value: str, root: str = "") -> str:
    if is_remote_media(value) or str(value).startswith(("/", "data:", "blob:")):
        return str(value)
    return f"{root}assets/audio/tracks/{value}"


def validate_audio(track: dict[str, Any], where: str, report: Report) -> None:
    audio = track["audio"]
    sources = audio.get("sources") or {}
    playable = {fmt: name for fmt, name in sources.items() if name}
    if not playable:
        # An imported MiniMax definition can exist before its render has been
        # copied into the site. Keep the cassette visible, but do not invent a
        # placeholder song just to satisfy the validator.
        audio["available"] = False
        report.warn(where, "has no synced audio source yet")
        return

    audio["available"] = True
    for fmt, name in playable.items():
        if is_remote_media(str(name)):
            continue
        if not (TRACK_AUDIO_DIR / name).exists():
            audio["available"] = False
            report.warn(where, f"{fmt} file assets/audio/tracks/{name} is not in the repository yet")

    duration = audio.get("duration")
    if duration is None:
        report.warn(where, "has no audio.duration, so the shelf cannot show a running time")
    elif not isinstance(duration, (int, float)) or duration <= 0:
        report.error(where, "audio.duration must be a positive number of seconds")

    preview = audio.get("preview") or {}
    if preview.get("src"):
        start = preview.get("start") or 0
        length = preview.get("duration") or 0
        if duration and start + length > duration:
            report.error(where, f"preview runs to {format_clock(start + length)}, past the end of the track")
        if not is_remote_media(str(preview["src"])):
            candidates = [PREVIEW_AUDIO_DIR / preview["src"], TRACK_AUDIO_DIR / preview["src"]]
            if not any(path.exists() for path in candidates):
                report.warn(where, f"preview file {preview['src']} is not in the repository yet")

    if audio.get("placeholder"):
        report.warn(where, "is still pointing at placeholder audio")


def attach_lyrics(track: dict[str, Any], where: str, report: Report) -> None:
    name = track["lyrics"].get("file")
    raw = track["lyrics"].get("raw")
    if not name:
        if raw:
            track["lyrics"]["cues"] = []
            track["lyrics"].setdefault("synchronisation", "none")
            return
        report.error(where, "has neither lyrics.file nor lyrics.raw")
        track["lyrics"]["cues"] = []
        return
    path = LYRIC_DIR / name
    if not path.exists():
        report.error(where, f"lyric source content-source/lyrics/{name} does not exist")
        track["lyrics"]["cues"] = []
        return
    track["lyrics"]["cues"] = parse_lrc(path, track["audio"].get("duration"), report)
    if track["lyrics"].get("status") == "placeholder":
        report.warn(where, "still has placeholder lyrics")


def validate_generation(track: dict[str, Any], where: str, report: Report) -> None:
    for section, keys in (("generation", ("cfg", "steps", "seed")), ("provenance", ("songVersion", "generationNumber"))):
        for key in keys:
            value = track[section].get(key)
            if value is None:
                continue
            if not isinstance(value, (int, float)):
                report.error(where, f"{section}.{key} should be a number, found {value!r}")
    if not track["model"].get("provider"):
        report.warn(where, "does not record which model generated it")


# --------------------------------------------------------------------------
# Rendering


def esc(value: Any) -> str:
    return html.escape(str(value), quote=True)


def render(template: str, values: dict[str, str]) -> str:
    output = template
    for key, value in values.items():
        output = output.replace("{{" + key + "}}", value)
    leftovers = re.findall(r"\{\{([A-Z_]+)\}\}", output)
    if leftovers:
        raise SystemExit(f"Template still contains unfilled tokens: {sorted(set(leftovers))}")
    return output


def sleeve_picture(track: dict[str, Any], root: str, sizes: str, lazy: bool) -> str:
    base = track["artwork"]["base"]
    path = f"{root}assets/img/sleeves/{base}"
    loading = 'loading="lazy" decoding="async"' if lazy else 'decoding="async"'
    return (
        "<picture>"
        f'<source type="image/webp" sizes="{sizes}" '
        f'srcset="{path}-640.webp 640w, {path}-1280.webp 1280w">'
        f'<img src="{path}-640.jpg" sizes="{sizes}" '
        f'srcset="{path}-640.jpg 640w, {path}-1280.jpg 1280w" '
        f'width="640" height="640" alt="{esc(track["artwork"]["alt"])}" {loading}>'
        "</picture>"
    )


def meta_rows(track: dict[str, Any]) -> str:
    model = track["model"]
    generation = track["generation"]
    provenance = track["provenance"]
    rows: list[tuple[str, str]] = []

    if model.get("provider"):
        rows.append(("Model", f"{model['provider']} {model.get('name') or ''}".strip()))
    if provenance.get("songVersion") is not None:
        rows.append(("Song version", str(provenance["songVersion"])))
    if provenance.get("generationNumber") is not None:
        rows.append(("Generation", f"#{provenance['generationNumber']}"))
    for label, key in (("CFG", "cfg"), ("Steps", "steps"), ("Seed", "seed")):
        if generation.get(key) is not None:
            rows.append((label, str(generation[key])))
    if track["style"].get("summary"):
        rows.append(("Style", track["style"]["summary"]))

    if not rows:
        return '<p class="meta__empty">Generation details for this one have not been written up yet.</p>'

    cells = "".join(
        f"<div class=\"meta__row\"><dt>{esc(label)}</dt><dd>{esc(value)}</dd></div>" for label, value in rows
    )
    return f'<dl class="meta">{cells}</dl>'


def shelf_card(track: dict[str, Any], index: int) -> str:
    title = esc(track["title"])
    subtitle = f'<p class="card__subtitle">{esc(track["subtitle"])}</p>' if track.get("subtitle") else ""
    catalogue = esc(track.get("catalogueNumber") or "")
    label_code = catalogue or esc(track.get("versionLabel") or "")
    running = format_clock(track["audio"].get("duration"))
    picture = sleeve_picture(track, "", "(max-width: 40rem) 76vw, (max-width: 70rem) 38vw, 18rem", lazy=index > 5)
    model = " ".join(filter(None, [track.get("model", {}).get("provider"), track.get("model", {}).get("name")]))
    style = track.get("style", {}).get("summary") or ""
    generation = track.get("generation", {})
    tech_bits = [model]
    if generation.get("cfg") is not None: tech_bits.append(f"CFG {generation['cfg']}")
    if generation.get("steps") is not None: tech_bits.append(f"S{generation['steps']}")
    release_line = track.get("versionLabel") or " · ".join(bit for bit in tech_bits if bit)
    release_html = f'<p class="card__version">{esc(release_line)}</p>' if release_line else ""
    search = esc(" ".join([track["title"], str(track.get("subtitle") or ""), catalogue, model, style, release_line]).lower())
    provider = esc((track.get("model", {}).get("provider") or "unknown").lower())
    status = esc(track.get("status") or "")
    composition = esc(track.get("composition") or track["id"])

    return f"""          <li class="card" data-track="{esc(track['id'])}" data-composition="{composition}">
            <button type="button" class="card__play" data-play="{esc(track['id'])}" aria-label="Latch and play {title}">
              <span class="cassette" aria-hidden="true">
                <span class="cassette__screw cassette__screw--1"></span><span class="cassette__screw cassette__screw--2"></span>
                <span class="cassette__screw cassette__screw--3"></span><span class="cassette__screw cassette__screw--4"></span>
                <span class="cassette__label">{picture}</span>
                <span class="cassette__window"><i class="cassette__reel"></i><b></b><i class="cassette__reel"></i></span>
                <span class="cassette__teeth"></span>
              </span>
            </button>
          </li>"""


def grouped_shelf(tracks: list[dict[str, Any]]) -> str:
    """Render one physical wall section per genre, with versions of the same
    composition kept immediately adjacent inside a single composition run."""
    genres: dict[str, dict[str, list[dict[str, Any]]]] = {}
    genre_labels: dict[str, str] = {}
    for track in tracks:
        style = track.get("style") or {}
        label = str(style.get("genre") or "Unclassified").strip() or "Unclassified"
        genre_key = label.casefold()
        composition = str(track.get("composition") or track.get("id") or "track")
        genre_labels.setdefault(genre_key, label)
        genres.setdefault(genre_key, {}).setdefault(composition, []).append(track)

    chunks: list[str] = []
    card_index = 0
    for genre_key in sorted(genres):
        compositions = genres[genre_key]
        tape_count = sum(len(items) for items in compositions.values())
        song_count = len(compositions)
        runs: list[str] = []
        for composition in sorted(compositions, key=str.casefold):
            items = compositions[composition]
            cards = []
            for track in items:
                cards.append(shelf_card(track, card_index))
                card_index += 1
            title = items[0].get("title") or composition
            label = f"{title}, {len(items)} version" + ("s" if len(items) != 1 else "")
            runs.append(
                f'<div class="composition-run" data-composition="{esc(composition)}" aria-label="{esc(label)}">'
                f'<ul class="composition-run__tapes">{"".join(cards)}</ul></div>'
            )
        chunks.append(
            '<section class="genre-cluster" data-genre="' + esc(genre_labels[genre_key]) + '">'
            '<header class="genre-cluster__header">'
            '<h3>' + esc(genre_labels[genre_key]) + '</h3>'
            '<span>' + str(tape_count) + ' tape' + ('s' if tape_count != 1 else '') + ' / ' + str(song_count) + ' song' + ('s' if song_count != 1 else '') + '</span>'
            '</header>'
            '<div class="genre-wall">' + ''.join(runs) + '</div>'
            '</section>'
        )
    return "\n".join(chunks)


def track_page(track: dict[str, Any], template: str, cues: list[dict[str, Any]], nav: str) -> str:
    root = "../../"
    if cues:
        lyric_lines = "".join(
            f'<li><span class="stamp">{format_clock(cue["start"])}</span>{esc(cue["text"])}</li>' for cue in cues
        )
    else:
        raw_lyrics = str(track.get("lyrics", {}).get("raw") or "")
        lyric_lines = "".join(
            f'<li class="transcript__raw">{esc(line)}</li>'
            for line in raw_lyrics.splitlines() if line.strip()
        )
    sources = track["audio"].get("sources") or {}
    source_tags = ""
    flac = sources.get("flac") or sources.get("lossless")
    if flac:
        source_tags += f'<source src="{esc(media_url(str(flac), root))}" type="audio/flac">'
    if sources.get("opus"):
        source_tags += f'<source src="{esc(media_url(str(sources["opus"]), root))}" type="audio/ogg; codecs=opus">'
    if sources.get("mp3"):
        source_tags += f'<source src="{esc(media_url(str(sources["mp3"]), root))}" type="audio/mpeg">'
    if sources.get("wav"):
        source_tags += f'<source src="{esc(media_url(str(sources["wav"]), root))}" type="audio/wav">'

    unavailable = ""
    if not track["audio"].get("available"):
        unavailable = (
            '<p class="notice">No hand-picked audio has been supplied for this cassette yet. '
            'Drop the chosen render into <code>showcase/</code> beside its YAML and rebuild.</p>'
        )

    notes = track["notes"].get("short")
    tags = track["style"].get("tags") or []

    return render(
        template,
        {
            "ROOT": root,
            "NAV": nav,
            "TITLE": esc(track["title"]),
            "SUBTITLE": f'<p class="detail__subtitle">{esc(track["subtitle"])}</p>' if track.get("subtitle") else "",
            "CATALOGUE": esc(track.get("catalogueNumber") or ""),
            "RELEASED": esc(track.get("released") or "unreleased"),
            "RUNNING": format_clock(track["audio"].get("duration")),
            "SLEEVE": sleeve_picture(track, root, "(max-width: 50rem) 90vw, 30rem", lazy=False),
            "META": meta_rows(track),
            "TAGS": "".join(f'<li>{esc(tag)}</li>' for tag in tags),
            "SOURCES": source_tags,
            "UNAVAILABLE": unavailable,
            "LYRICS": lyric_lines,
            "LYRIC_NOTE": (
                '<p class="notice">These lyrics are a placeholder.</p>'
                if track["lyrics"].get("status") == "placeholder"
                else ""
            ),
            "NOTES": f'<p class="detail__notes">{esc(notes)}</p>' if notes else "",
            "PROMPT": (
                '<h2 class="detail__heading">Generation prompt</h2><div class="prose prompt-copy"><p>'
                + esc(track.get("prompt", {}).get("caption") or "").replace("\n", "</p><p>")
                + '</p></div>'
                if track.get("prompt", {}).get("caption") else ""
            ),
            "DISCLOSURE": (
                "Generated with an AI music model." if track.get("aiGenerated") else "Recorded without AI generation."
            ),
            "YEAR": str(date.today().year),
        },
    )


# --------------------------------------------------------------------------


def build(strict: bool) -> int:
    report = Report()
    print("Reading content sources")
    tracks = load_tracks(report)
    if report.errors:
        return report.summarise(strict)

    sections = build_docs.discover(report)
    nav_root = build_docs.nav_html(sections, "")
    nav_music = build_docs.nav_html(sections, "../", "music")
    nav_track = build_docs.nav_html(sections, "../../", "music")

    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LYRIC_OUT_DIR.mkdir(parents=True, exist_ok=True)

    # Remove generated records for tracks that no longer exist. Without this,
    # replacing a hand-written track with a MiniMax-synced release leaves ghost
    # pages and lyric JSON behind in the deployed site.
    valid_ids = {track["id"] for track in tracks}
    valid_slugs = {track["slug"] for track in tracks}
    for old in LYRIC_OUT_DIR.glob("*"):
        if old.is_file() and old.stem not in valid_ids:
            old.unlink()
    if MUSIC_DIR.exists():
        for old in MUSIC_DIR.iterdir():
            if old.is_dir() and old.name not in valid_slugs:
                shutil.rmtree(old)

    catalogue: list[dict[str, Any]] = []

    for track in tracks:
        cues = track["lyrics"].pop("cues", [])
        track_id = track["id"]

        (LYRIC_OUT_DIR / f"{track_id}.json").write_text(
            json.dumps(cues, indent=2) + "\n", encoding="utf-8"
        )
        (LYRIC_OUT_DIR / f"{track_id}.vtt").write_text(cues_to_vtt(cues), encoding="utf-8")

        entry = {
            "id": track_id,
            "composition": track.get("composition") or track_id,
            "versionLabel": track.get("versionLabel"),
            "slug": track["slug"],
            "title": track["title"],
            "subtitle": track.get("subtitle"),
            "catalogueNumber": track.get("catalogueNumber"),
            "released": track.get("released"),
            "status": track.get("status"),
            "model": track["model"],
            "provenance": track["provenance"],
            "generation": track["generation"],
            "style": track["style"],
            "audio": track["audio"],
            "artwork": track["artwork"],
            "links": track["links"],
            "prompt": track["prompt"],
            "notes": track["notes"],
            "aiGenerated": track.get("aiGenerated"),
            "lyrics": {
                "synchronisation": track["lyrics"].get("synchronisation", "line"),
                "status": track["lyrics"].get("status"),
                "raw": track["lyrics"].get("raw"),
                "vtt": f"data/lyrics/{track_id}.vtt",
                "cues": cues,
            },
        }
        catalogue.append(entry)

        track["lyrics"]["cues"] = cues

    (DATA_DIR / "catalogue.json").write_text(json.dumps(catalogue, indent=2) + "\n", encoding="utf-8")

    index_template = (TEMPLATE_DIR / "index.html").read_text(encoding="utf-8")
    track_template = (TEMPLATE_DIR / "track.html").read_text(encoding="utf-8")

    shelf = grouped_shelf(tracks)
    (ROOT / "index.html").write_text(
        render(
            index_template,
            {
                "ROOT": "",
                "SHELF": shelf,
                "CATALOGUE_JSON": json.dumps(catalogue, separators=(",", ":")).replace("</", "<\\/"),
                "TRACK_COUNT": str(len(tracks)),
                "NAV": nav_root,
                "YEAR": str(date.today().year),
            },
        ),
        encoding="utf-8",
    )

    rows = "".join(
        '<li><span class="stamp">{number}</span>'
        '<span><a href="{slug}/">{title}</a> — {running}{subtitle}</span></li>'.format(
            number=esc(track.get("catalogueNumber") or ""),
            slug=esc(track["slug"]),
            title=esc(track["title"]),
            running=format_clock(track["audio"].get("duration")),
            subtitle=f' · {esc(track["subtitle"])}' if track.get("subtitle") else "",
        )
        for track in tracks
    )
    MUSIC_DIR.mkdir(parents=True, exist_ok=True)
    (MUSIC_DIR / "index.html").write_text(
        render(
            (TEMPLATE_DIR / "music-index.html").read_text(encoding="utf-8"),
            {
                "ROOT": "../",
                "ROWS": rows,
                "TRACK_COUNT": str(len(tracks)),
                "NAV": nav_music,
                "YEAR": str(date.today().year),
            },
        ),
        encoding="utf-8",
    )

    for track in tracks:
        directory = MUSIC_DIR / track["slug"]
        directory.mkdir(parents=True, exist_ok=True)
        (directory / "index.html").write_text(
            track_page(track, track_template, track["lyrics"]["cues"], nav_track), encoding="utf-8"
        )

    doc_pages = build_docs.build(sections, render, report)

    catalogue_bytes = (DATA_DIR / "catalogue.json").stat().st_size
    index_bytes = (ROOT / "index.html").stat().st_size
    print(f"Built {len(tracks)} tracks")
    print(f"  index.html      {index_bytes / 1024:.0f} KB (catalogue embedded, no runtime fetch)")
    print(f"  catalogue.json  {catalogue_bytes / 1024:.0f} KB")
    print(f"  track pages     {len(tracks)} + /music/ index")
    print(f"  note pages      {doc_pages} across {len(sections)} sections")

    if index_bytes > 250 * 1024:
        report.warn(
            "index.html",
            "is over 250 KB. Embedding every lyric stops scaling around here — "
            "switch the player to fetch data/lyrics/<id>.json on selection.",
        )

    return report.summarise(strict)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--strict", action="store_true", help="treat warnings as errors, as CI should")
    raise SystemExit(build(parser.parse_args().strict))
