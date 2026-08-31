#!/usr/bin/env python3
"""Build showcase records ONLY from files deliberately placed in ./showcase.

Nothing outside the repository is scanned. The user's MiniMax working directory
is never touched.

Drop one of the shared song YAMLs beside its chosen cover and chosen render(s):

    showcase/
      dogtushya-v2.yaml
      dogtushya.png
      dogtushya-v2_CFG-1.70_STEP-31_SEED-7.flac

Subfolders are also allowed. If several matching renders are deliberately put in
showcase, each becomes a cassette. If no render is present, the cassette remains
visible but is marked unavailable.
"""
from __future__ import annotations

import json
import re
import shutil
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    raise SystemExit("PyYAML is required: pip install PyYAML")

ROOT = Path(__file__).resolve().parent.parent
DROP = ROOT / "showcase"
TRACK_OUT = ROOT / "content-source" / "tracks" / "showcase"
MASTERS = ROOT / "masters"
AUDIO_OUT = ROOT / "assets" / "audio" / "tracks"
MANIFEST = ROOT / "content-source" / "showcase-manifest.json"
LIVE_LYRICS_OUT = ROOT / "data" / "live-lyrics"
LIVE_LYRICS_FORMAT = "gbr-word-lyrics-v1"
PLACEHOLDER_ART_BASE = "gbr-placeholder"
AUDIO_EXTS = {".flac", ".wav", ".mp3", ".opus", ".ogg", ".m4a"}
IMAGE_EXTS = {".png", ".jpg", ".jpeg", ".webp"}


def slugify(value: str) -> str:
    value = value.strip().lower().replace("_", "-")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return re.sub(r"-+", "-", value).strip("-") or "track"


def normalised_stem(path: Path) -> str:
    # Sweep files are often numbered: 1gimmie-gimmie-ball-v2_CFG-...
    return re.sub(r"^\d+", "", path.stem.lower()).lstrip(" _-")


def resolve_cover(source_yaml: Path, name: str | None) -> Path | None:
    if not name:
        return None
    candidate = Path(str(name))
    direct = source_yaml.parent / candidate
    if direct.is_file():
        return direct

    # Hand-picked showcase is deliberately small. Searching only THIS folder is
    # useful when YAML + art are dropped flat, while still refusing to trawl any
    # external MiniMax directory.
    matches = [p for p in DROP.rglob(candidate.name) if p.is_file() and p.suffix.lower() in IMAGE_EXTS]
    return matches[0] if len(matches) == 1 else None


def discover_audio(source_yaml: Path, title: str) -> list[Path]:
    source = source_yaml.stem.lower()
    composition = slugify(title)

    candidates = [
        p for p in DROP.rglob("*")
        if p.is_file() and p.suffix.lower() in AUDIO_EXTS
    ]

    # Prefer the YAML filename prefix, e.g. dogtushya-v2_CFG-... .
    exact = []
    for p in candidates:
        stem = normalised_stem(p)
        if stem == source or stem.startswith(source + "_") or stem.startswith(source + "-"):
            exact.append(p)

    found = exact
    if not found:
        # Fallback for selected legacy renders which omitted -vN.
        for p in candidates:
            stem = normalised_stem(p)
            if stem == composition or stem.startswith(composition + "_") or stem.startswith(composition + "-"):
                found.append(p)

    rank = {".flac": 0, ".wav": 1, ".opus": 2, ".ogg": 3, ".mp3": 4, ".m4a": 5}
    return sorted(found, key=lambda p: (rank.get(p.suffix.lower(), 99), p.name.lower()))



def live_lyrics_sidecar(audio: Path | None) -> tuple[Path | None, dict[str, Any] | None]:
    """Return the exact per-audio word-timing sidecar, if the user generated one."""
    if not audio:
        return None, None
    candidates = [
        audio.with_name(audio.stem + ".lyrics.json"),
        audio.with_name(audio.stem + ".live-lyrics.json"),
    ]
    for path in candidates:
        if not path.is_file():
            continue
        try:
            data = json.loads(path.read_text(encoding="utf-8"))
        except Exception as exc:
            print(f"warn {path.relative_to(DROP)}: invalid live-lyrics JSON ({exc})")
            return None, None
        if not isinstance(data, dict) or data.get("format") != LIVE_LYRICS_FORMAT or not isinstance(data.get("lines"), list):
            print(f"warn {path.relative_to(DROP)}: not a {LIVE_LYRICS_FORMAT} file")
            return None, None
        return path, data
    return None, None


def generation_from_name(name: str) -> dict[str, Any]:
    def number(patterns: list[str], cast):
        for pattern in patterns:
            match = re.search(pattern, name, re.IGNORECASE)
            if match:
                try:
                    return cast(match.group(1))
                except ValueError:
                    pass
        return None

    return {
        "cfg": number([r"(?:^|[_-])CFG[-_]?(-?\d+(?:\.\d+)?)"], float),
        "steps": number([r"(?:^|[_-])(?:STEP|STP)[-_]?(\d+)"], int),
        "seed": number([r"(?:^|[_-])SEED[-_]?(-?\d+)"], int),
        "lmsdSeed": number([r"(?:^|[_-])LMSDD?[-_]?(-?\d+)"], int),
        "spsdSeed": number([r"(?:^|[_-])SPSD[-_]?(-?\d+)"], int),
    }


def model_fields(value: Any) -> dict[str, str]:
    """Preserve the model name supplied by the source YAML, while making the
    familiar families display cleanly in the existing site schema."""
    text = str(value or "").strip()
    if not text:
        return {"provider": "Unknown", "name": ""}
    low = text.lower()
    if low.startswith("minimax"):
        tail = text[len("minimax"):].strip(" -_")
        return {"provider": "MiniMax", "name": tail}
    if low.startswith("acestep") or low.startswith("ace-step") or low.startswith("ace step"):
        tail = re.sub(r"(?i)^ace[- ]?step", "", text).strip(" -_")
        return {"provider": "ACE-Step", "name": tail}
    parts = text.split(None, 1)
    return {"provider": parts[0], "name": parts[1] if len(parts) > 1 else ""}


def genre_value(raw: dict[str, Any]) -> str:
    genre = raw.get("genre")
    if isinstance(genre, list):
        genre = " / ".join(str(item).strip() for item in genre if str(item).strip())
    return str(genre or "Unclassified").strip() or "Unclassified"


def version_label(version: Any, generation: dict[str, Any], model: Any = None) -> str:
    model_text = str(model or "").strip()
    if version is not None:
        bits = [f"{model_text} · v{version}" if model_text else f"v{version}"]
    else:
        bits = [model_text or "Version"]
    if generation.get("cfg") is not None:
        bits.append(f"CFG {generation['cfg']:g}")
    if generation.get("steps") is not None:
        bits.append(f"S{generation['steps']}")
    return " · ".join(bits)


def format_key(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".flac": "flac", ".wav": "wav", ".mp3": "mp3",
        ".opus": "opus", ".ogg": "opus", ".m4a": "m4a",
    }.get(ext, ext.lstrip("."))


def write_track(raw: dict[str, Any], source_yaml: Path, audio: Path | None, index: int, art_base: str, live_lyrics: dict[str, Any] | None = None, artwork_placeholder: bool = False) -> Path:
    title = str(raw.get("title") or source_yaml.stem)
    composition = slugify(title)
    version = raw.get("version")
    generation = generation_from_name(audio.stem if audio else source_yaml.stem)
    release_id = slugify(audio.stem if audio else source_yaml.stem)

    sources = {"flac": None, "wav": None, "opus": None, "mp3": None}
    if audio:
        sources[format_key(audio)] = audio.name

    inspiration = str(raw.get("inspiration") or "").strip()
    record = {
        "id": release_id,
        "composition": composition,
        "catalogueNumber": None,
        "title": title,
        "subtitle": None,
        "slug": release_id,
        "versionLabel": version_label(version, generation, raw.get("model")),
        "status": str(raw.get("state") or ("active" if index == 0 else "generation")),
        "released": None,
        "model": model_fields(raw.get("model")),
        "provenance": {
            "songVersion": version,
            "generationNumber": None,
            "sourceYaml": str(source_yaml.relative_to(DROP)).replace("\\", "/"),
            "sourceAudio": audio.name if audio else None,
            "sourceState": raw.get("state"),
        },
        "generation": generation,
        "style": {
            "genre": genre_value(raw),
            "inspiration": inspiration,
            "summary": genre_value(raw),
            "tags": [genre_value(raw)],
        },
        "audio": {
            "duration": raw.get("duration"),
            "placeholder": audio is None,
            "sources": sources,
            "preview": {},
        },
        "lyrics": {
            "raw": str(raw.get("lyrics") or "").rstrip(),
            "synchronisation": "word" if live_lyrics and live_lyrics.get("usable", True) else "none",
            "status": "source",
            "wordTiming": live_lyrics,
        },
        "artwork": {
            "base": art_base,
            "alt": f"Placeholder artwork for {title}." if artwork_placeholder else f"Cover artwork for {title}.",
            "placeholder": artwork_placeholder,
        },
        "prompt": {"caption": str(raw.get("caption") or "").strip()},
        "links": {"experiment": None, "songDefinition": None},
        "notes": {"short": inspiration},
        "aiGenerated": True,
        "generatedFromShowcaseDrop": True,
    }
    out = TRACK_OUT / f"{release_id}.yaml"
    out.write_text(yaml.safe_dump(record, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")
    return out


def clean_previous_generated() -> None:
    """Remove only things created by the prior curated import."""
    if MANIFEST.exists():
        try:
            previous = json.loads(MANIFEST.read_text(encoding="utf-8"))
        except Exception:
            previous = []
        for item in previous if isinstance(previous, list) else []:
            if not isinstance(item, dict):
                continue
            for name in item.get("audio", []):
                p = AUDIO_OUT / Path(str(name)).name
                if p.is_file():
                    p.unlink()
            for name in item.get("liveLyrics", []):
                p = LIVE_LYRICS_OUT / Path(str(name)).name
                if p.is_file():
                    p.unlink()
            cover_name = item.get("master")
            if cover_name:
                p = MASTERS / Path(str(cover_name)).name
                if p.is_file():
                    p.unlink()

    # content-source/tracks is generated build state in the curated workflow.
    # Older GBR versions wrote track YAMLs directly into content-source/tracks/,
    # so purge all generated YAML records before rebuilding. Otherwise a repository
    # upgraded in place can accidentally publish/validate obsolete tracks.
    track_root = ROOT / "content-source" / "tracks"
    if track_root.exists():
        for p in track_root.rglob("*.yaml"):
            p.unlink()
        for p in track_root.rglob("*.yml"):
            p.unlink()


def main() -> int:
    DROP.mkdir(parents=True, exist_ok=True)
    TRACK_OUT.mkdir(parents=True, exist_ok=True)
    MASTERS.mkdir(parents=True, exist_ok=True)
    AUDIO_OUT.mkdir(parents=True, exist_ok=True)
    LIVE_LYRICS_OUT.mkdir(parents=True, exist_ok=True)
    clean_previous_generated()

    yaml_files = sorted([*DROP.rglob("*.yaml"), *DROP.rglob("*.yml")])
    if not yaml_files:
        print(f"No YAML files in {DROP}")
        print("Drop your hand-picked song YAML + cover + audio into that folder.")
        return 0

    manifest: list[dict[str, Any]] = []
    for source_yaml in yaml_files:
        try:
            raw = yaml.safe_load(source_yaml.read_text(encoding="utf-8")) or {}
        except Exception as exc:
            print(f"skip {source_yaml.relative_to(DROP)}: invalid YAML ({exc})")
            continue
        if not isinstance(raw, dict) or not raw.get("title"):
            print(f"skip {source_yaml.relative_to(DROP)}: no title")
            continue

        title = str(raw["title"])
        version = raw.get("version")
        art_base = slugify(f"{title}-v{version}" if version is not None else title)

        cover = resolve_cover(source_yaml, raw.get("cover"))
        copied_cover = None
        artwork_placeholder = False
        if cover:
            copied_cover = MASTERS / f"{art_base}{cover.suffix.lower()}"
            shutil.copy2(cover, copied_cover)
        else:
            artwork_placeholder = True
            art_base = PLACEHOLDER_ART_BASE
            print(
                f"warn {source_yaml.relative_to(DROP)}: cover {raw.get('cover')!r} not found in showcase/; "
                f"using built-in {PLACEHOLDER_ART_BASE} artwork"
            )

        selected = discover_audio(source_yaml, title)
        staged_audio: list[Path] = []
        seen_generation_stems: set[str] = set()
        for audio in selected:
            stem_key = audio.stem.lower()
            if stem_key in seen_generation_stems:
                continue
            seen_generation_stems.add(stem_key)
            target = AUDIO_OUT / audio.name
            shutil.copy2(audio, target)
            staged_audio.append(target)

        records = []
        staged_live_lyrics: list[str] = []
        if staged_audio:
            for index, audio in enumerate(staged_audio):
                # Use the original showcase audio to locate its exact sidecar; the
                # staged audio has the same basename but lives outside showcase/.
                original_audio = next((item for item in selected if item.name == audio.name), None)
                sidecar, sidecar_data = live_lyrics_sidecar(original_audio)
                live_info = None
                if sidecar and sidecar_data:
                    release_id = slugify(audio.stem)
                    runtime_name = f"{release_id}.json"
                    shutil.copy2(sidecar, LIVE_LYRICS_OUT / runtime_name)
                    staged_live_lyrics.append(runtime_name)
                    stats = sidecar_data.get("stats") if isinstance(sidecar_data.get("stats"), dict) else {}
                    quality = sidecar_data.get("quality") if isinstance(sidecar_data.get("quality"), dict) else {}
                    coverage = stats.get("coverage")
                    # Backward-compatible safety gate: v1 sidecars from the original
                    # aligner had stats.coverage but no quality object. Treat <80%
                    # as review-required rather than blindly enabling karaoke.
                    inferred_review = isinstance(coverage, (int, float)) and float(coverage) < 0.80
                    review_required = bool(quality.get("review_required", inferred_review))
                    approved = bool(quality.get("approved", False))
                    usable = bool(quality.get("usable_for_live_lyrics", approved or not review_required))
                    live_info = {
                        "src": f"data/live-lyrics/{runtime_name}",
                        "format": LIVE_LYRICS_FORMAT,
                        "coverage": coverage,
                        "source": sidecar.name,
                        "rating": quality.get("rating"),
                        "reviewRequired": review_required,
                        "approved": approved,
                        "usable": usable,
                    }
                records.append(write_track(raw, source_yaml, audio, index, art_base, live_info, artwork_placeholder).name)
        else:
            records.append(write_track(raw, source_yaml, None, 0, art_base, None, artwork_placeholder).name)

        manifest.append({
            "source": str(source_yaml.relative_to(DROP)).replace("\\", "/"),
            "title": title,
            "version": version,
            "master": copied_cover.name if copied_cover else None,
            "audio": [p.name for p in staged_audio],
            "liveLyrics": staged_live_lyrics,
            "records": records,
        })

        print(f"{source_yaml.relative_to(DROP)}")
        if staged_audio:
            for p in staged_audio:
                print(f"  + {p.name}")
                live_name = f"{slugify(p.stem)}.json"
                if live_name in staged_live_lyrics:
                    original_audio = next((item for item in selected if item.name == p.name), None)
                    _sidecar, _sidecar_data = live_lyrics_sidecar(original_audio)
                    _quality = _sidecar_data.get("quality") if isinstance((_sidecar_data or {}).get("quality"), dict) else {}
                    _stats = _sidecar_data.get("stats") if isinstance((_sidecar_data or {}).get("stats"), dict) else {}
                    _cov = _stats.get("coverage")
                    _inferred_review = isinstance(_cov, (int, float)) and float(_cov) < 0.80
                    _review_required = bool(_quality.get("review_required", _inferred_review))
                    _approved = bool(_quality.get("approved", False))
                    if _review_required and not _approved:
                        _cov_text = f"{float(_cov) * 100:.1f}%" if isinstance(_cov, (int, float)) else "unknown coverage"
                        print(f"    ! word sync {live_name} awaiting review ({_cov_text}); site will use fallback lyrics")
                    else:
                        print(f"    ~ word sync {live_name}")
                else:
                    print("    . no word-timing sidecar (raw/line lyrics will be used)")
        else:
            print("  ! no chosen audio beside/in showcase")
        print(f"  -> {len(records)} cassette(s)")

    MANIFEST.parent.mkdir(parents=True, exist_ok=True)
    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Imported {len(manifest)} deliberately selected song definition(s) from showcase/ only.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
