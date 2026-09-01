# Good Boy Records v6

Clean rebuild of the Good Boy Records cassette player. The visual layer was restarted from scratch rather than inheriting the v5 layout cascade.

## Source workflow

Keep your hand-picked files in `showcase/`: YAML + matching audio + artwork + optional `*.lyrics.json` word-timing sidecar. The existing importer/build tools turn those files into the static GitHub Pages site.

## v6 player features

- One responsive layout on desktop and mobile: cropped cassette carousel left, four-module player rack right.
- Song groups randomise on refresh while versions stay together.
- Drag/swipe, mouse-wheel, keyboard and button carousel navigation.
- Cassette selection animation plus synthesised mechanical insert/latch sound.
- Continuous playback. Shuffle prefers a different song title before another version of the same song.
- MP3, Opus, WAV and FLAC source selection with optional remembered lossless preference.
- Word-timed lyric sidecars with large current-word focus and dimmed last-sung word during pauses.
- Line-timed/raw lyric fallback if a word sidecar is absent or not approved.
- Post-EQ 18-band segmented spectrum with fast rise and visible decay.
- Hidden five-band Web Audio EQ (60 / 250 / 1k / 4k / 12k, ±9 dB), remembered locally, with limiter.
- Volume, progress, previous, next, shuffle and play/pause controls.
- Media Session metadata and next/previous handlers where supported.
- Compact technical metadata drawer.
- No VU meters and no visible track-title module.
- One shared `<audio>` element.

## Local use

Run `START-SITE.bat`, or from the project directory run:

```text
python tools/import_showcase.py
python tools/prepare_artwork.py masters assets/img/sleeves
python tools/build_catalogue.py
python tools/serve.py
```

Do not judge the Web Audio EQ/spectrum via `file://`; browsers can mute or block a `MediaElementAudioSourceNode` for local opaque origins. Use the local HTTP server or GitHub Pages.

## GitHub Pages

`GITHUB-WORKFLOW-static.yml` contains a complete root-repository workflow reference. In the `port` repository it belongs at `.github/workflows/gbr-pages.yml`. The project itself remains at `good-boy-records/`.
