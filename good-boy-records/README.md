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
- **The empty bay.** A tape held in the deck leaves an impression pressed into
  the drum rather than a hole: no colour of its own, just a dark edge where the
  light would not reach and a faint lit edge where it would. Shell, label
  window and tape window all take the same two-line treatment, so the whole
  shape reads as one stamping.
- **Track titling.** A plate under the artwork carrying the title and the
  version / genre / catalogue / duration chips. v6 showed the track title
  nowhere at all — recognising the sleeve was the only way to know what was on.
  No free prose here: `notes.short` and `subtitle` go to the technical drawer
  instead, so the plate stays a label rather than a paragraph.

## Side folders

Manila tabs down the right edge pull out a paper sheet over the machine, for
long-form text that does not belong in the metadata drawer. Paper is already
established in this interface by the VU faces, so prose gets a readable surface
without inventing a new visual language for it.

Content lives in `content-source/folders/*.md`, one file per tab:

```
---
tab: Notes            # label down the side, ~12 characters
title: Sleeve notes
order: 3
---

Body markdown here.
```

Markdown goes through the same conservative dependency-free subset the written
pages use, so headings, lists, tables, quotes, links and fenced code all work.
Files sort by `order`, then filename; a leading `01-` in the filename is
stripped from the element id. A file with broken frontmatter is skipped with a
warning rather than failing the build. Delete a file to remove its tab; remove
them all and the tabs, the gutter reserved for them, and the drawer disappear
entirely.

The three files currently in there are placeholders — replace them.

The tabs are a proper tablist: arrow keys move along the strip, Escape closes
and returns focus to the tab that opened the drawer, and the transport
keyboard shortcuts go inert while a sheet is open so space-to-play does not
fire while you are reading.

## The cassette load sound

v6 used three oscillators, which read as a UI blip because mechanisms are
noise, not tone. It is now nine filtered noise bursts and two low body hits,
scheduled as the sequence a real deck makes: the shell sliding down the well,
the well bottoming out, the latch catching, the chassis absorbing it, the
spring flap settling, then the two reel hubs engaging a few milliseconds apart.
Timings and filter frequencies are jittered per play, so repeated loads do not
sound identical.

It runs on its own `AudioContext`, deliberately. Routing it through the program
graph would put the latch through the user's EQ and, worse, spike the VU meters
with a sound that is not the record. Its level follows the output slider.

## Bays and takes

The wall used to carry one tape per take, so forty songs at three attempts each
produced a hundred and twenty tapes. It now carries one **bay** per song.

A bay is not a single tape, though — it holds every take as a stack, and the
sleeve at the front is whichever take is loaded. That matters because takes
differ in artwork and often in genre, and that difference is most of the reason
for keeping them. Switching take swaps the front sleeve, the deck artwork, the
genre chip and the technical drawer together.

The bay at the pickup point **fans out**, so every take's sleeve is visible
rather than hidden behind the front one; the rest of the wheel keeps its bays
collapsed so the column stays readable. Spread is computed from the take count
and capped, so six attempts do not fan across the whole column. A fanned sleeve
can be clicked directly to load that take.

Only the *selected* take is in the deck, so only its slot in the bay reads as
empty — the others keep their sleeves. That is both what a real magazine looks
like and how the other artwork stays visible while something is playing.

The magazine is lit by four fills from the corners plus a key spot aimed at the
bay under the pickup, so the whole wall is readable while the loaded bay is
clearly the subject. They are two layers off one knob with different response
curves — fill rises early so the wall is never black, key climbs later and
harder — which is what gives the control its range. The knob is continuous
rather than stepped, because the right brightness depends on the room, and the
level persists.

Three things guard against the other takes being missed:

- The bay's tag reads `3 takes` rather than a version number, and the stack
  visibly fans, so depth is legible from the wall itself.
- The dial is always present, even for a single-take song, where it shows one
  detent labelled `v1` and simply does not turn. Every detent is named, so the
  dial says what each position *is* rather than leaving you to count round it — so it is a fixed part of the deck rather
  than something that appears and disappears. It sits immediately left of the
  song name — the control that changes
  the name is next to the name — and its legend reads `Take 1 of 3` in words
  rather than a bare `v1`.
- When a multi-take song is latched the dial gives one small nudge, so it
  announces itself instead of waiting to be noticed.

The dial has one detent per take, a lit tick at the current position, and a
sprung detent click deliberately unlike the cassette latch so the two are never
confused. A song with one take shows no dial at all rather than a control that
does nothing. Arrow keys step it either way; clicking steps forward and wraps.

Clicking the bay that is already in the deck also steps to the next take, so the
carousel remains a way to reach versions and not merely songs.

Shuffle draws from every take rather than from songs, so versions come up on
their own. It still prefers a different composition first, so a run does not sit
on one song playing its takes back to back.

## The meter bank and console

The VU movements are a side-by-side pair drawn into one canvas: cream dial,
scalloped skirt with the needle emerging from it, warm lamp burning up through
the face from below, dark bezel with corner screws, red band from 0 VU, and the
percentage-modulation row under the main scale. Ballistics are unchanged — a
spring solver at roughly 300 ms to full deflection with the slight overshoot a
real movement has.

Underneath them sits the console: five condensed EQ faders, a FLAT reset, and
the power switch. There is only ever **one** set of EQ controls in the document.
On narrow viewports the console element is moved into the EQ popover and the
top-bar EQ button appears; on wide viewports it moves back inline and the button
hides. Moving the node rather than rendering two sets keeps a single binding to
the audio graph.

## Power

The deck boots into standby and switches itself on shortly after first paint:
needles sweep the full scale and fall back, the lamps come up, and the
electromechanical sequence plays — switch clack, relay, transformer swelling to
temperature with its second harmonic, a decaying degauss buzz beating against
itself, capstan and reel motors spinning up, then the mechanism settling.

Off is a real state rather than a dimmer: playback stops, the transport and
magazine stop responding, the dials go grey and unlit, and the spectrum falls
away instead of freezing on its last frame.

**Caveat worth knowing.** Browsers will not let a page make noise before it has
been touched, so the power-up sound is usually blocked on a cold load. The
sequence still runs visually, and the sound is armed to fire on the first real
interaction, so the machine is heard coming alive rather than never at all. On a
site the browser already trusts it plays immediately. Toggling the switch by
hand always makes sound, because that is a gesture.

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
- MP3, Opus, WAV and FLAC. Format selection is a ranked list, not a single
  guess: the lossless switch and the browser's `canPlayType` only *order* the
  candidates, they never remove the last one. A FLAC-only take plays with the
  switch off, an MP3-only take plays with it on, and if a file fails to load
  the deck falls through to the next candidate rather than stopping.
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
