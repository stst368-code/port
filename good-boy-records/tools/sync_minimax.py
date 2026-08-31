#!/usr/bin/env python3
"""Mirror the existing MiniMax project into the static Good Boy Records site.

The MiniMax folder remains the source of truth. This script reads the native
song YAML files from <MiniMax>/input, copies their cover art, discovers matching
generated audio under <MiniMax>/output, and writes generated site records under
content-source/tracks/minimax/. Do not hand-edit those generated records.

Default Windows source:
  %USERPROFILE%\\OneDrive\\CREATIVE and REPAIRS\\!MISC\\MiniMax

Usage:
  python tools/sync_minimax.py
  python tools/sync_minimax.py --root "D:\\somewhere\\MiniMax"
"""
from __future__ import annotations

import argparse
import json
import os
import re
import shutil
from pathlib import Path
from typing import Any

try:
    import yaml
except ImportError:
    raise SystemExit("PyYAML is required: pip install PyYAML")

ROOT = Path(__file__).resolve().parent.parent
TRACK_OUT = ROOT / "content-source" / "tracks" / "minimax"
RAW_OUT = ROOT / "content-source" / "minimax"
MASTERS = ROOT / "masters"
AUDIO_OUT = ROOT / "assets" / "audio" / "tracks"
MANIFEST = RAW_OUT / "sync-manifest.json"
AUDIO_EXTS = {".flac", ".wav", ".mp3", ".opus", ".ogg", ".m4a"}


def slugify(value: str) -> str:
    value = value.strip().lower().replace("_", "-")
    value = re.sub(r"[^a-z0-9]+", "-", value)
    return re.sub(r"-+", "-", value).strip("-") or "track"


def default_root() -> Path:
    explicit = os.environ.get("MINIMAX_ROOT")
    if explicit:
        return Path(explicit)
    home = Path(os.environ.get("USERPROFILE") or Path.home())
    return home / "OneDrive" / "CREATIVE and REPAIRS" / "!MISC" / "MiniMax"


def resolve_cover(root: Path, input_dir: Path, name: str | None) -> Path | None:
    if not name:
        return None
    candidate = Path(name)
    checks = [input_dir / candidate, root / candidate, root / "covers" / candidate, root / "artwork" / candidate]
    for path in checks:
        if path.exists() and path.is_file():
            return path
    # Covers are small in number; a basename search is safer than imposing a second folder convention.
    for path in root.rglob(candidate.name):
        if path.is_file() and "output" not in {part.lower() for part in path.parts}:
            return path
    return None


def discover_audio(output_dir: Path, source_stem: str, composition: str) -> list[Path]:
    if not output_dir.exists():
        return []

    def normalised_stem(path: Path) -> str:
        # Sweep files are commonly numbered: 1gimmie-gimmie-ball-v2_CFG-...
        return re.sub(r"^\d+", "", path.stem.lower()).lstrip(" _-")

    candidates: list[Path] = []
    for path in output_dir.rglob("*"):
        if not path.is_file() or path.suffix.lower() not in AUDIO_EXTS:
            continue
        if any(part.lower() == "_cache" for part in path.parts):
            continue
        candidates.append(path)

    source = source_stem.lower()
    exact = [p for p in candidates if (lambda stem: stem == source or stem.startswith(source + "_") or stem.startswith(source + "-"))(normalised_stem(p))]
    if exact:
        found = exact
    else:
        # Legacy outputs sometimes omit the -vN suffix. Only use the broad song
        # match when no version-specific files exist, otherwise v2/v3 would mix.
        comp = composition.lower()
        found = [p for p in candidates if (lambda stem: stem == comp or stem.startswith(comp + "_") or stem.startswith(comp + "-"))(normalised_stem(p))]

    # Lossless first, then deterministic filename order. We keep every generation rather than silently choosing a winner.
    rank = {".flac": 0, ".wav": 1, ".opus": 2, ".ogg": 3, ".mp3": 4, ".m4a": 5}
    return sorted(found, key=lambda p: (rank.get(p.suffix.lower(), 99), p.name.lower()))


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


def version_label(version: Any, generation: dict[str, Any]) -> str:
    bits = [f"MiniMax v{version}" if version is not None else "MiniMax"]
    if generation.get("cfg") is not None:
        bits.append(f"CFG {generation['cfg']:g}")
    if generation.get("steps") is not None:
        bits.append(f"S{generation['steps']}")
    return " · ".join(bits)


def source_map_for(path: Path) -> tuple[str, str]:
    ext = path.suffix.lower()
    if ext == ".flac": return "flac", "audio/flac"
    if ext == ".wav": return "wav", "audio/wav"
    if ext == ".mp3": return "mp3", "audio/mpeg"
    if ext in {".opus", ".ogg"}: return "opus", "audio/ogg"
    return ext.lstrip("."), "application/octet-stream"


def write_track(raw: dict[str, Any], source_yaml: Path, audio: Path | None, index: int, art_base: str) -> Path:
    title = str(raw.get("title") or source_yaml.stem)
    composition = slugify(title)
    version = raw.get("version")
    generation = generation_from_name(audio.stem if audio else source_yaml.stem)

    if audio:
        release_id = slugify(audio.stem)
        fmt, _ = source_map_for(audio)
        sources = {"flac": None, "wav": None, "opus": None, "mp3": None}
        if fmt in sources:
            sources[fmt] = audio.name
        else:
            sources[fmt] = audio.name
    else:
        release_id = slugify(source_yaml.stem)
        sources = {"flac": None, "wav": None, "opus": None, "mp3": None}

    lyrics = str(raw.get("lyrics") or "").rstrip()
    caption = str(raw.get("caption") or "").strip()
    inspiration = str(raw.get("inspiration") or "").strip()
    record = {
        "id": release_id,
        "composition": composition,
        "catalogueNumber": None,
        "title": title,
        "subtitle": None,
        "slug": release_id,
        "versionLabel": version_label(version, generation),
        "status": "featured" if index == 0 else "generation",
        "released": None,
        "model": {"provider": "MiniMax", "name": "Music 3"},
        "provenance": {
            "songVersion": version,
            "generationNumber": None,
            "sourceYaml": source_yaml.name,
            "sourceAudio": audio.name if audio else None,
        },
        "generation": {
            "cfg": generation.get("cfg"),
            "steps": generation.get("steps"),
            "seed": generation.get("seed"),
            "lmsdSeed": generation.get("lmsdSeed"),
            "spsdSeed": generation.get("spsdSeed"),
        },
        "style": {"summary": inspiration, "tags": ["minimax"]},
        "audio": {
            "duration": raw.get("duration"),
            "placeholder": audio is None,
            "sources": sources,
            "preview": {},
        },
        "lyrics": {"raw": lyrics, "synchronisation": "none", "status": "source"},
        "artwork": {
            "base": art_base,
            "alt": f"Cover artwork for {title}.",
        },
        "prompt": {"caption": caption},
        "links": {"experiment": None, "songDefinition": f"content-source/minimax/{source_yaml.name}"},
        "notes": {"short": inspiration},
        "aiGenerated": True,
        "generatedFromMiniMax": True,
    }
    out = TRACK_OUT / f"{release_id}.yaml"
    out.write_text(yaml.safe_dump(record, sort_keys=False, allow_unicode=True, width=120), encoding="utf-8")
    return out


def clean_previous_audio() -> None:
    """Remove only files copied by the previous MiniMax sync.

    This keeps the GitHub Pages payload from quietly accumulating obsolete
    sweep renders while leaving any manually managed audio untouched.
    """
    if not MANIFEST.exists():
        return
    try:
        previous = json.loads(MANIFEST.read_text(encoding="utf-8"))
    except Exception:
        return
    for item in previous if isinstance(previous, list) else []:
        for name in item.get("audio", []) if isinstance(item, dict) else []:
            path = AUDIO_OUT / Path(str(name)).name
            if path.exists() and path.is_file():
                path.unlink()


def main(root: Path) -> int:
    input_dir = root / "input"
    output_dir = root / "output"
    if not input_dir.exists():
        raise SystemExit(f"MiniMax input folder not found: {input_dir}")

    TRACK_OUT.mkdir(parents=True, exist_ok=True)
    RAW_OUT.mkdir(parents=True, exist_ok=True)
    MASTERS.mkdir(parents=True, exist_ok=True)
    AUDIO_OUT.mkdir(parents=True, exist_ok=True)
    clean_previous_audio()

    # This folder is generated exclusively by this script, so replacing it is safe.
    for old in TRACK_OUT.glob("*.yaml"):
        old.unlink()

    manifest: list[dict[str, Any]] = []
    yaml_files = sorted([*input_dir.glob("*.yaml"), *input_dir.glob("*.yml")])
    for source_yaml in yaml_files:
        raw = yaml.safe_load(source_yaml.read_text(encoding="utf-8")) or {}
        if not isinstance(raw, dict) or not raw.get("title"):
            print(f"skip {source_yaml.name}: no title")
            continue

        shutil.copy2(source_yaml, RAW_OUT / source_yaml.name)
        title = str(raw["title"])
        composition = slugify(title)
        version = raw.get("version")
        art_base = slugify(f"{title}-v{version}" if version is not None else title)
        cover = resolve_cover(root, input_dir, raw.get("cover"))
        copied_cover = None
        if cover:
            copied_cover = MASTERS / f"{art_base}{cover.suffix.lower()}"
            shutil.copy2(cover, copied_cover)
        else:
            print(f"warn {source_yaml.name}: cover {raw.get('cover')!r} not found")

        audio_files = discover_audio(output_dir, source_yaml.stem, composition)
        staged_audio: list[Path] = []
        seen_stems: set[str] = set()
        for audio in audio_files:
            # If the same generation exists as FLAC + WAV/MP3, discover_audio
            # already puts FLAC first. Keep one release instead of making duplicate
            # cassettes for encoding derivatives of the same generation.
            stem_key = audio.stem.lower()
            if stem_key in seen_stems:
                continue
            seen_stems.add(stem_key)
            target = AUDIO_OUT / audio.name
            if audio.resolve() != target.resolve():
                shutil.copy2(audio, target)
            staged_audio.append(target)

        generated = []
        if staged_audio:
            for index, audio in enumerate(staged_audio):
                generated.append(write_track(raw, source_yaml, audio, index, art_base).name)
        else:
            generated.append(write_track(raw, source_yaml, None, 0, art_base).name)

        manifest.append({
            "source": source_yaml.name,
            "title": title,
            "version": version,
            "cover": str(copied_cover.relative_to(ROOT)) if copied_cover else None,
            "audio": [path.name for path in staged_audio],
            "records": generated,
        })
        if staged_audio:
            print(f"{source_yaml.name}: {len(staged_audio)} generation(s)")
            for staged in staged_audio:
                print(f"  + {staged.name}")
        else:
            print(f"{source_yaml.name}: NO MATCHING AUDIO FOUND")
        print(f"  -> {len(generated)} site record(s)")

    MANIFEST.write_text(json.dumps(manifest, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print(f"Synced {len(manifest)} MiniMax song definition(s) from {root}")
    print("Next: python tools/prepare_artwork.py masters assets/img/sleeves")
    print("      python tools/build_catalogue.py")
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--root", type=Path, default=default_root(), help="MiniMax project root")
    raise SystemExit(main(parser.parse_args().root.expanduser()))
