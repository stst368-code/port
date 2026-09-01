#!/usr/bin/env python3
"""Smoke checks for the clean v6 Good Boy Records player."""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parent.parent
html = (ROOT / "index.html").read_text(encoding="utf-8")
css = (ROOT / "assets/css/v6.css").read_text(encoding="utf-8")
js = (ROOT / "assets/js/v6.js").read_text(encoding="utf-8")

checks = []
def check(name, ok):
    checks.append((name, bool(ok)))

check("one shared audio element", html.count('id="gbr-audio"') == 1)
check("clean two-column machine", 'class="gbr-machine"' in html and 'grid-template-columns:1fr 2fr' in css)
check("same mobile proportions", 'grid-template-columns:34% 66%' in css)
check("spectrum exists", 'id="gbr-spectrum"' in html)
check("artwork exists", 'id="gbr-artwork"' in html)
check("controls exist", all(x in html for x in ['id="gbr-play"','id="gbr-shuffle"','id="gbr-progress"','id="gbr-volume"']))
check("focused lyrics exist", 'id="gbr-lyric-word"' in html)
check("VU meters absent", 'vu__' not in html and 'meter-bank' not in html)
check("track title display absent", 'deck-title' not in html and 'ACTIVE CHANNEL' not in html)
check("EQ popup exists", 'id="gbr-eq-popover"' in html and 'data-eq-frequency="60"' in html)
check("technical drawer exists", 'id="gbr-tech-panel"' in html)
check("word timing loader exists", 'gbr-word-lyrics-v1' in js)
check("shuffle avoids same song where possible", 't.title!==current.title' in js)
check("media session exists", 'MediaMetadata' in js)
check("cassette insert sound exists", 'playInsertSound' in js)
check("carousel drag exists", 'pointerdown' in js and 'pointermove' in js)
check("lossless selection exists", 'gbr:lossless' in js and 'audio/flac' in js)
check("post-EQ analyser exists", 'createBiquadFilter' in js and 'createAnalyser' in js)
check("no legacy player stylesheet", 'site.css' not in html)
check("no important cascade pile", css.count('!important') <= 1)

for name, ok in checks:
    print(("  PASS  " if ok else "  FAIL  ") + name)
print(("ALL PASS" if all(v for _, v in checks) else "FAILURES PRESENT") + f" ({sum(v for _,v in checks)}/{len(checks)})")
raise SystemExit(0 if all(v for _,v in checks) else 1)
