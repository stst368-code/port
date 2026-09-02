# Good Boy Records v7

Cassette player for the Good Boy Records catalogue. v7 keeps the v6 palette and
the rotary-magazine idea, and rebuilds the layer underneath them: geometry,
responsiveness, and the instrumentation that v6 dropped.

## What changed from v6.3, and why

### The cassette sizing bug

v6 sized things in a circle. `--diameter` was `min(200%, 75svh)` — a percentage
of the column the wheel lived in — and `renderCarousel()` then derived both the
orbit radius and the cassette size from that wheel's measured box:

```js
var d = Math.max(1, Math.min(rect.width, rect.height));
var cardSize = Math.max(62, Math.min(210, d * 0.235));
```

The column sized the wheel and the wheel sized the tapes, so on any narrow
column the whole chain bottomed out at the 62px floor. Worse, because `200%`
resolves against a different axis for `width` than for `height`, the "circle"
was really an ellipse and `min(width, height)` picked the short one.

v7 measures the column once per resize, derives cassette width from it, and
derives the wheel from the cassettes. The dependency only ever runs one way.
Desktop tapes are now ~172px instead of 62–148px.

### The tapes were pointing at the wrong place

The card transform put angle 0 at twelve o'clock:

```css
rotate(var(--angle)) translateY(calc(-1 * var(--orbit-px)))
```

But the wheel's centre sits at the left edge of the column, vertically centred.
Twelve o'clock is therefore off-screen above the column, so the "selected"
cassette was never visible and the tapes you could see were just whichever ones
happened to swing through the crescent. v7 places cards from three o'clock, so
the pickup tape sits next to the step buttons where the interface implies it is.

### Cassettes could not be selected with a mouse

Separate from the sizing bug, and worth writing down because it is easy to
reintroduce. The carousel called `setPointerCapture()` on `pointerdown` so that
a drag could continue outside the element. Pointer capture retargets the
subsequent `click` to the capturing element, so the delegated handler saw
`event.target === #gbr-cards`, `closest('.card')` returned null, and it bailed.
Every click on a tape did nothing.

Capture is now deferred until the pointer has actually moved more than 4px, so
a plain click never captures and reaches the card normally. The click handler
also falls back to whatever was recorded at `pointerdown`. Both are covered by
tests, because the failure is silent — no error, just nothing happening.

### Mobile

The `34% / 66%` split gave the magazine about 133px on a phone. Wheel 266px,
cards at the 62px floor, centred on x = 0 — half of every tape was outside the
viewport. v7 switches the magazine to a horizontal snap rail below 860px,
grouped by song, using the `track-group__title` markup the build tool was
already emitting and the stylesheet was hiding.

Both modes share one DOM. `data-magazine` on `<html>` selects between them and
`MAGAZINE_QUERY` in the JS mirrors the CSS breakpoint — change both together.

### Heights that could not resolve

Every percentage height inside the machine was resolving against a
`min-height`, which is not a definite size. That is what let the artwork push
the page 317px past the viewport once it had real intrinsic dimensions.
`.gbr-app` is now `height: 100dvh`, and the rack scrolls internally if a window
is genuinely too short.

## Rack arrangement

```
+-------------------------------------------------------------+
| spectrum, full width                                         |
+-----------------------------------+-------------------------+
|              sleeve               |      VU meter, L        |
|          title / version          +-------------------------+
|         genre / cat / time        |      VU meter, R        |
+-----------------------------------+-------------------------+
| transport                                                   |
+-------------------------------------------------------------+
| lyric word                                                   |
+-------------------------------------------------------------+
```

The rack itself carries no text titles in either mode — the sleeve art is the
identifier. The `track-group__title` headings the build tool emits are kept in
the accessibility tree rather than removed with `display: none`, so tabbing
through the tapes still announces which song each group belongs to. The version
chips stay visible, since a sleeve cannot tell you which take you are looking
at.

The five modules are placed explicitly on the rack grid rather than wrapped in
container elements, so the narrow-viewport block re-places the same markup into
a single column with the two instruments sharing a strip at the foot. Below
620px of height the spectrum row drops out and the VU bank stays.

The VU face geometry is derived from the plate's aspect ratio, so one drawing
routine covers both the tall movement beside the artwork and the short wide
strip on a phone: sweep comes from the aspect, radius from the width, and the
pivot falls below the plate as it does on real hardware, with the needle
emerging from a shroud along the bottom.

## Restored

- **Stereo VU meters.** Canvas, fed by a `ChannelSplitter` off the post-limiter
  tap. Spring ballistics (~300 ms with the slight overshoot a real movement
  has), non-linear VU face, peak-hold pip, overload lamp. `VU_REFERENCE = 9`
  puts 0 VU at -9 dBFS: studio alignment of -18 would leave the needles pinned
  in the red against any modern master.
- **Track titling.** A plate beside the artwork carrying title, subtitle, and
  version / genre / catalogue / duration chips. v6 showed the track title
  nowhere at all — recognising the sleeve was the only way to know what was on.

## Also fixed

- Spectrum moved from 180 DOM nodes toggling classes every frame to one canvas.
- The rAF loop idles when nothing is playing and the needles have settled.
- Scrubbing no longer fights `timeupdate`. v6 had a `seeking` flag it never
  read, so the thumb was overwritten mid-drag.
- Transport glyphs (`▶ ◀ ⤨ Ⅱ`) replaced with SVG; the roman numeral used for
  pause rendered inconsistently across platforms.
- Sleeve `sizes` hint corrected in `build_catalogue.py`. It advertised
  `76vw` for an image that is never wider than ~210px, so every tape pulled the
  1280w file.
- `ResizeObserver` on the magazine and the meter canvases.
- Empty magazine states what to do instead of rendering a blank drum.
- Visible focus rings; `prefers-reduced-motion` respected throughout.

## Layout contract

Three rules the stylesheet depends on. Breaking one is how v6 got into trouble:

1. Nothing sizes itself from a percentage of a box whose size depends on that
   percentage.
2. Two magazine modes, one DOM. No rule reads a viewport width except the media
   queries at the foot of `v7.css`.
3. The rack is `auto / 1fr / auto / auto`, never fixed percentages. Artwork is
   the only element allowed to absorb slack, so short windows shrink the art
   instead of crushing the transport.

## Player features

- Rotary magazine on desktop: drag, wheel, keyboard, and step buttons.
- Snap rail on mobile, grouped by song, centring the latched tape.
- Song groups randomise per visit; versions of a song stay together.
- Cassette fly-in animation and synthesised mechanical latch sound.
- Continuous play. Shuffle prefers a different song before another version of
  the same one.
- MP3, Opus, WAV and FLAC selection with a remembered lossless preference.
- Word-timed lyric sidecars with large current-word focus; line-timed fallback.
- Five-band Web Audio EQ (60 / 250 / 1k / 4k / 12k, ±9 dB) with limiter,
  remembered locally.
- Media Session metadata and next/previous handlers.
- Technical metadata drawer.
- One shared `<audio>` element.

## Local use

```text
python tools/import_showcase.py
python tools/prepare_artwork.py masters assets/img/sleeves
python tools/build_catalogue.py
python tools/serve.py
```

Do not judge the EQ or the meters over `file://`. Browsers can mute or block a
`MediaElementAudioSourceNode` for local opaque origins, and seeking needs HTTP
Range support. Use the local server or GitHub Pages.

`python tools/test_player.py` runs the smoke checks. `python tools/make_demo.py`
writes a throwaway `_demo/` with generated sleeves and a fake catalogue, for
eyeballing layout changes without touching real media — delete it when done.

## GitHub Pages

`GITHUB-WORKFLOW-static.yml` is the root-repository workflow reference; in the
`port` repository it belongs at `.github/workflows/gbr-pages.yml`.
