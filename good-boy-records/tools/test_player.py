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
# The plate is title plus chips only. Free prose about a track belongs in the
# technical drawer, not under the title.
check("no prose line on the title plate",
      'id="gbr-subtitle"' not in html and ".gbr-plate-sub" not in css)
check("track notes still reach the technical drawer", "notes.short" in js)

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
check("shuffle reaches takes, not just songs",
      "t.composition !== current.composition" in js and "playableTracks" in js)
check("media session exists", "MediaMetadata" in js)
check("cassette insert sound exists", "playInsertSound" in js)
check("carousel drag exists", "pointerdown" in js and "pointermove" in js)
check("lossless selection exists", "gbr:lossless" in js and "audio/flac" in js)
check("post-EQ analyser exists", "createBiquadFilter" in js and "createAnalyser" in js)

# --- layout arrangement -----------------------------------------------------
check("spectrum spans the full top of the rack", ".gbr-analyser  { grid-column: 1 / -1" in css)
check("VU bank sits beside the deck", ".gbr-meters    { grid-column: 2;" in css)
check("sleeve precedes the title plate",
      html.index('id="gbr-art-frame"') < html.index('id="gbr-title"'))
check("rack order is spectrum, deck, VU",
      template.index("gbr-analyser") < template.index("gbr-deck") < template.index("gbr-meters"))
check("meter geometry is derived, not hard coded",
      "meterGeometry" in js and "METER_SWEEP" in js)
# The sleeves carry the titles, so no text titles are painted on the rack.
check("no song titles painted on the rack", "track-group__title" not in css)
check("bay names reach assistive tech", 'aria-label="Latch ' in
      (ROOT / "tools/build_catalogue.py").read_text(encoding="utf-8"))

# --- one bay per song, with every take inside it ---------------------------
check("wall is built from bays", "shelf_bay" in
      (ROOT / "tools/build_catalogue.py").read_text(encoding="utf-8"))
check("a bay carries its takes", "data-tracks" in
      (ROOT / "tools/build_catalogue.py").read_text(encoding="utf-8") and "bayTakes" in js)
check("takes stack behind the selected sleeve", ".cassette-stack" in css and "paintStack" in js)

# --- take dial --------------------------------------------------------------
check("dial detents equal takes", "dialAngles" in js and "takes.length" in js)
check("dial is always present, locked when there is one take",
      "el.take.hidden = false" in js and 'data-locked="true"' in css)
check("every detent is named", "gbr-dial-labels" in template and "dialLabels" in js)
check("dial states the count so takes are not missed", '"Take " + (chosen + 1) + " of "' in js)
check("dial announces itself on latch", "callDial" in js and "is-calling" in css)
check("dial has its own detent sound", "playDetent" in js)
check("carousel is still a way to reach takes", "stepTake(1); return;" in js)

# --- cassette load sound ----------------------------------------------------
# Mechanisms are noise, not tone. Oscillators alone gave the v6 UI blip.
check("insert sound is noise based", "createBufferSource" in js and "fx.noise" in js)
check("insert sound has the full mechanism sequence",
      all(x in js for x in ["Shell sliding", "Latch catches", "reel hubs"]))
check("insert sound stays off the program graph and meters",
      "fxContext" in js and "own AudioContext" in js)
check("insert sound follows the output level", "clamp(0, audio.volume, 1)" in js)

# --- side folders -----------------------------------------------------------
check("folder tabs are built from markdown", (ROOT / "tools/build_folders.py").exists())
check("template has a folder slot", "{{FOLDERS}}" in template)
check("folders are wired into the single build command",
      "build_folders" in (ROOT / "tools/build_catalogue.py").read_text(encoding="utf-8"))
check("folder drawer is styled as paper", ".gbr-folder-sheet" in css and ".gbr-folder-tab" in css)
check("shell reserves a gutter for the tabs", ".gbr-app:has(> .gbr-folders)" in css)
check("folders are a tablist with escape and focus return",
      'role="tablist"' in (ROOT / "tools/build_folders.py").read_text(encoding="utf-8")
      and "closeFolders(true)" in js)
check("playback keys are inert while a folder is open",
      "if (folders.root && folders.root.dataset.open) return;" in js)

# --- meters, console and power ---------------------------------------------
check("meters are a side-by-side pair", "meterSplit" in js and "drawMeterFace" in js)
check("dial has the scalloped skirt", "dialPath" in js)
check("dial is lamp lit", "lamp.addColorStop" in js and "rgba(255, 176, 60" in js)
check("percent-modulation row is drawn", "PERCENT" in js)
check("console holds the EQ and power switch",
      'id="gbr-console"' in html and 'id="gbr-power"' in html and "gbr-mini-eq" in html)
check("only one set of EQ controls exists", html.count('data-eq-frequency="60"') == 1)
check("console relocates instead of duplicating", "placeConsole" in js and 'id="gbr-console-slot"' in html)
check("power is a real state, not a dimmer",
      'data-power="off"' in css and "audio.pause();" in js and "setPower" in js)
check("power-up runs a needle sweep", "sweepUntil" in js)
check("power sound falls back to first interaction", "armPowerSound" in js)
check("power sequence is electromechanical", "degauss" in js.lower() and "hum(" in js)

# --- empty bay --------------------------------------------------------------
# The tape in the deck leaves an impression in the drum, not a hole.
check("empty bay is etched, not blank",
      "only its slot is empty" in css and "rgba(255, 200, 128" in css)

# --- magazine lamp ----------------------------------------------------------
check("magazine has its own lamp", ".gbr-lamp" in css and "--lamp" in js)
check("lamp brightness is a continuous knob, not detents",
      'role="slider"' in template and "lamp.drag" in js)
check("lamp level persists", '"gbr:lamp"' in js)

# --- fanned bays ------------------------------------------------------------
# Stacking hid the other takes' artwork, which defeated the point of keeping
# them. The bay at the pickup point fans so every sleeve is legible.
check("bays fan at the pickup point", "--fan-x" in js and "--fan-x" in css)
check("fan spread is capped for many takes", "88 / (total - 1)" in js)
check("only the selected take reads as removed",
      '.card.is-in-deck .cassette[data-front="true"]' in css)
check("a fanned sleeve can be picked directly", 'sleeve.dataset.front === "false"' in js)

# --- restore bug ------------------------------------------------------------
# Number(null) is 0, which passed the range guard and zeroed the control.
check("missing stored values do not read as zero", "recallNumber" in js)

# --- lamp, EQ and source fallback ------------------------------------------
check("lamp is four corner fills plus a key spot",
      "46% 40% at 0% 0%" in css and ".gbr-lamp-key" in css and "--spot-x" in js)
check("fill and key have different response curves",
      "Math.pow(lamp.value, 0.75)" in js and "Math.pow(lamp.value, 1.5)" in js)
check("EQ faders beat the base range rules on specificity",
      '.gbr-mini-eq input[type="range"]::-webkit-slider-thumb' in css)
check("EQ console lines up with the dial canvas above it",
      "Same inset as the dial canvas" in css)

# A FLAC-only track played with lossless off, or an MP3-only track with it on,
# used to yield no source at all. Preference now only orders candidates.
check("source selection is a ranked list", "sourceCandidates" in js and "SOURCE_KINDS" in js)
check("preference orders candidates without discarding them",
      "it never removes" in js and "found.sort" in js)
check("a failed source falls through to the next", "nextCandidate" in js)
check("lossless switch stays usable on tracks without a master",
      "el.lossless.disabled = false;" in js)

# --- regressions we do not want back ---------------------------------------
# Capturing the pointer on pointerdown retargets the following click to the
# container, which made cassettes unselectable with a mouse. Capture must be
# deferred until a drag actually starts, and the click handler must have a
# fallback to whatever the pointer went down on.
check("pointer capture is deferred until a drag starts",
      "mag.dragging.captured = true" in js and "captured: false" in js)
check("click falls back to the pointerdown target", "mag.lastHit" in js)
check("scrubbing is not fought by timeupdate", "_isScrubbing" in js)
check("no legacy player stylesheet", "site.css" not in html)
check("no important cascade pile", css.count("!important") <= 2)
check("empty magazine says what to do", "build_catalogue.py" in template)

for name, ok in checks:
    print(("  PASS  " if ok else "  FAIL  ") + name)
passed = sum(1 for _, ok in checks if ok)
print(("ALL PASS" if passed == len(checks) else "FAILURES PRESENT") + f" ({passed}/{len(checks)})")
raise SystemExit(0 if passed == len(checks) else 1)
