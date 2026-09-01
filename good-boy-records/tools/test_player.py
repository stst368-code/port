#!/usr/bin/env python3
"""Smoke checks for the v7 Good Boy Records player.

These guard the things that have actually broken before: layout geometry that
depends on itself, missing instrumentation, and cascade pile-ups.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / "index.html").read_text(encoding="utf-8")
template = (ROOT / "templates/index.html").read_text(encoding="utf-8")
css = (ROOT / "assets/css/v7.css").read_text(encoding="utf-8")
js = (ROOT / "assets/js/v7.js").read_text(encoding="utf-8")

checks: list[tuple[str, bool]] = []


def check(name: str, ok: object) -> None:
    checks.append((name, bool(ok)))


# --- structure -------------------------------------------------------------
check("one shared audio element", html.count('id="gbr-audio"') == 1)
check("template and index agree on assets", "v7.css" in html and "v7.css" in template)
check("no v6 assets left behind", "v6.css" not in html and "v6.js" not in html)

# --- the things that were missing and have been put back --------------------
check("stereo VU meters present", 'id="gbr-vu"' in html and "analyserL" in js)
check("VU has real ballistics", "VU_SCALE" in js and "ch.vel" in js)
check("track title plate present", 'id="gbr-title"' in html and "paintPlate" in js)
check("title plate carries version and catalogue", 'data-kind="version"' in js and "catalogueNumber" in js)

# --- the geometry bug this rebuild exists to fix ----------------------------
check("cassette size measured from the column", "--card-w" in js and "lane * 0.62" in js)
check("no self-referential wheel diameter", "min(200%" not in css)
check("shell height is definite", "height: 100dvh" in css)
check("rack rows are auto/1fr, not fixed percentages",
      "grid-template-rows: auto minmax(0, 1fr) auto auto" in css)
check("magazine has a narrow-viewport mode", 'data-magazine="rail"' in css and "MAGAZINE_QUERY" in js)
check("layout re-measures on resize", "ResizeObserver" in js)

# --- retained v6 behaviour --------------------------------------------------
check("spectrum exists", 'id="gbr-spectrum"' in html)
check("artwork exists", 'id="gbr-artwork"' in html)
check("controls exist", all(x in html for x in
      ['id="gbr-play"', 'id="gbr-shuffle"', 'id="gbr-progress"', 'id="gbr-volume"']))
check("focused lyrics exist", 'id="gbr-lyric-word"' in html)
check("EQ popup exists", 'id="gbr-eq-popover"' in html and 'data-eq-frequency="60"' in html)
check("technical drawer exists", 'id="gbr-tech-panel"' in html)
check("word timing loader exists", "gbr-word-lyrics-v1" in js)
check("shuffle avoids same song where possible", "t.title !== current.title" in js)
check("media session exists", "MediaMetadata" in js)
check("cassette insert sound exists", "playInsertSound" in js)
check("carousel drag exists", "pointerdown" in js and "pointermove" in js)
check("lossless selection exists", "gbr:lossless" in js and "audio/flac" in js)
check("post-EQ analyser exists", "createBiquadFilter" in js and "createAnalyser" in js)

# --- regressions we do not want back ---------------------------------------
check("scrubbing is not fought by timeupdate", "_isScrubbing" in js)
check("no legacy player stylesheet", "site.css" not in html)
check("no important cascade pile", css.count("!important") <= 2)
check("empty magazine says what to do", "build_catalogue.py" in template)

for name, ok in checks:
    print(("  PASS  " if ok else "  FAIL  ") + name)
passed = sum(1 for _, ok in checks if ok)
print(("ALL PASS" if passed == len(checks) else "FAILURES PRESENT") + f" ({passed}/{len(checks)})")
raise SystemExit(0 if passed == len(checks) else 1)
