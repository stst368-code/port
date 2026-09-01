# Good Boy Records

Static GitHub Pages music showcase built as one warm late-70s/early-80s hi-fi
machine at every viewport size. The fixed player uses dark walnut, black
faceplates, amber VU/spectrum lighting, a live two-line lyric glass and a real
shared audio transport. The current sleeve is displayed directly in the deck.

The collection is now a rotary cassette magazine inspired by slide-projector
carousels. Song groups are randomised on each refresh while versions remain
adjacent. Drag/swipe or the arrow controls rotate the same magazine on desktop,
tablet and mobile. Selecting a cassette rotates it to the pickup position,
animates it out of its slot into the player bay, and leaves an empty magazine
slot while it is loaded. Shuffle performs a longer motorised spin before loading
a random playable cassette.

The five-band Web Audio EQ still exists, but it is deliberately hidden behind
the hardware `EQ` button rather than permanently occupying the faceplate.

## No generated `music/` catalogue

The rotary cassette magazine and fixed player are the catalogue. Older builds generated
`music/<slug>/index.html` permanent track pages; that subsystem has been removed.
`showcase/` is the only human-managed music source, and the deployment no longer
stages a `music/` directory. Lyrics and technical metadata open inside the central
player instead.

## The `showcase/` folder is the only music source

The site does **not** scan your MiniMax project, output folder, OneDrive, or any
other working directory.

You choose what is public. Drop only the finished items you want to show into:

```text
showcase/
├── dogtushya-v2.yaml
├── dogtushya.png
├── dogtushya-v2_CFG-1.70_STEP-31_SEED-7.flac
├── another-song-v2.yaml
├── another-song.png
└── another-song-v2.flac
```

Subfolders are allowed too, so this is equally valid:

```text
showcase/
└── dogtushya/
    ├── dogtushya-v2.yaml
    ├── dogtushya.png
    └── dogtushya-v2_CFG-1.70_STEP-31_SEED-7.flac
```

The importer understands the shared song YAML fields already being used:
`title`, `version`, `model`, `state`, `genre`, `inspiration`, `duration`, `cover`,
`caption`, and `lyrics`. You do not need to rewrite those into a website-specific
file. `genre` remains useful catalogue metadata but does not create visible sections.
Versions with the same `title` remain adjacent in the rotary magazine. Whole song
groups are shuffled as units on each page refresh, while missing genres remain
`Unclassified` in metadata.

Audio is matched to the YAML by filename. A render beginning with the YAML stem,
for example `dogtushya-v2_...flac`, belongs to `dogtushya-v2.yaml`. Legacy files
without the `-vN` suffix also have a title-based fallback.

If you deliberately drop several matching renders into `showcase/`, each chosen
render becomes its own cassette/version. CFG, STEP/STP and SEED values are read
from filenames when present.

Nothing outside `showcase/` is discovered or copied.


## Upgrading an older repository

`showcase/` is the only authoritative music source. The importer now removes stale
generated YAML records left by older versions under `content-source/tracks/`, and
the catalogue builder reads only `content-source/tracks/showcase/`. This prevents
old demo/placeholder tracks from reappearing in GitHub Actions after an in-place
upgrade.


## GitHub workflow location

This project lives at `good-boy-records/` inside the `port` repository. GitHub only
loads workflow files from the repository-root `.github/workflows/` directory.

Copy `GITHUB-WORKFLOW-static.yml` to this exact repository path:

```text
port/
├── .github/
│   └── workflows/
│       └── static.yml
└── good-boy-records/
    ├── showcase/
    ├── tools/
    └── ...
```

Do not put `.github/workflows/` inside `good-boy-records/`. The supplied workflow
uses the explicit path `$GITHUB_WORKSPACE/good-boy-records`; it does not auto-detect
or guess which copy of the project to build.

## Build on Windows

Run:

```text
START-SITE.bat
```

It runs `BUILD-SHOWCASE.bat`, which:

1. Reads only `showcase/`.
2. Converts the selected native YAML into generated site records.
3. Copies only the selected audio into the runtime audio folder.
4. Generates web artwork derivatives from the selected cover.
5. Rebuilds the catalogue/pages and checks internal links.
6. Starts the local preview at `http://localhost:8000/`.

You can run `BUILD-SHOWCASE.bat` by itself when you only want to rebuild.

## FLAC and GitHub Pages

Hand-picked FLAC files in `showcase/` are intentionally allowed by `.gitignore`
so they can be committed with the project. During the build they are copied into
the runtime site and deployed on GitHub Pages.

The Pages workflow stages runtime files only and checks that no individual file
reaches 100 MiB and that the staged site remains below 1 GiB.

There is no external object-storage requirement in this build.

## Player behaviour

- One shared `<audio>` element for the entire wall.
- Click a new cassette: it performs a short mechanical latch movement **in its
  current wall position**, glows amber and starts playback.
- Click the currently latched cassette again: play/pause toggles in place.
- Only the selected playing cassette spins its own reels.
- Selecting a cassette never calls `scrollIntoView()` and never relocates it.
- On desktop the central transport is genuinely `position: fixed` at viewport centre.
  The cassette wall owns the page scroll and moves past it on both sides.
- The player itself is not a scroll container; wheel/trackpad scrolling over the
  machine continues to move the page. Only the explicitly opened lyrics/technical
  drawer has a small internal scrolling region.
- The lower monitor rack is information/transport UI only. It does not contain a
  duplicate inserted cassette.
- Tape/Vinyl remains a persisted appearance switch using the same player state.
- Native MiniMax lyrics are displayed even when no separately timed LRC exists.


## Centre-player wall layout

The desktop wall is arranged around a centre transport that remains vertically centred while the collection scrolls. Each song appears once as a titled vertical stack. Its versions sit directly beneath that title, and each cassette gets only a small `V1`, `V2`, `V3` marker to its left. Genre sections remain the outer grouping.

The centre column is intentionally reserved for the fixed desktop player, so cassettes pass on the left and right rather than disappearing underneath it. Lyrics and technical metadata live in a collapsible drawer on the player to keep the permanent centre hardware compact. On narrower screens the player becomes a sticky top-centred transport and the two wall lanes collapse responsively.

## Wall grouping and player EQ

The wall is generated as `song -> version`. Genre remains metadata rather than visible wall chrome.
as slim hardware shelf labels, while versions of one song are kept as one
vertical cassette stack under a single shared title. Nothing is alphabetically
or technically filtered at runtime; the grouping is resolved at build time.

The player exposes the YAML `inspiration` field as its own readout and includes a
real five-band Web Audio EQ (60 Hz, 250 Hz, 1 kHz, 4 kHz and 12 kHz, +/-9 dB).
Settings are remembered locally. EQ and VU processing are intentionally disabled
for direct `file://` opens because Chromium can mute local MediaElement sources
when routed through Web Audio. `START-SITE.bat` and GitHub Pages both use HTTP,
where the EQ operates normally.

The cassette shell is intentionally squarer than a physical Compact Cassette.
Its art panel is genuinely square, so 1:1 album covers fit without the old wide
label crop; the reel window and lower mechanics sit over the artwork.

## Word-timed live lyrics

The website contains **no WhisperX, Demucs, PyTorch, model cache or alignment
environment**. Word timing is produced by the separate `GBR-LyricAligner` tool,
which should live outside this Git repository.

Point that tool at this repository's `showcase/` folder. For each selected audio
file it may write one tiny sidecar beside the source media:

```text
pity-pawty-v2_CFG-1.70_STEP-31_SEED-7.flac
pity-pawty-v2_CFG-1.70_STEP-31_SEED-7.lyrics.json
```

That JSON is the only alignment artefact the website needs. `BUILD-SHOWCASE.bat`
automatically validates and copies an exact matching sidecar into generated
`data/live-lyrics/`. The browser lazy-loads it only when that cassette is
selected, scrolls the current lyric line, and gives the currently sung word the
incandescent amber highlight.

No sidecar is required. If one is absent or invalid, the player falls back to
the existing line-timed LRC/raw YAML lyrics and playback is unaffected. See
`WORD-LYRICS.md` for the small file contract consumed by the site.

## Included example

The supplied `dogtushya-v2.yaml` and `dogtushya.png` are in `showcase/` as the
example content. No fake audio is included. Put the exact Dogtushya render you
want visitors to hear beside them and rebuild.


## Word-timing quality gate

Word-timed `*.lyrics.json` sidecars are generated by the separate GBR Lyric Aligner. New sidecars carry a quality/review state. Low-confidence alignment files remain available for inspection but are not used for live word highlighting until approved in the external aligner. The player automatically falls back to ordinary lyrics, so a questionable forced alignment cannot break playback or present interpolated timing as trustworthy. See `WORD-LYRICS.md`.

## Manual build

```bash
pip install PyYAML Pillow
python tools/import_showcase.py
python tools/prepare_artwork.py masters assets/img/sleeves
python tools/build_catalogue.py
python tools/check_links.py
python tools/serve.py
```

### Markdown dependency note

The documentation build does not require the `markdown` or `mistune` Python packages. The renderer is bundled in `tools/build_docs.py`. The only Python packages listed in `requirements.txt` are PyYAML and Pillow, which are used for YAML parsing and artwork preparation.

## Missing artwork fallback

Artwork is no longer deployment-critical. If a YAML references a cover that is not present (or a cover cannot be processed), the build uses a built-in `gbr-placeholder` cassette sleeve and continues publishing the rest of the showcase. The console still warns so the real art can be corrected later.


## v5.15 layout

The player/mixer is fixed across the top of the viewport as a warm black/brown/amber hi-fi rack. The cassette catalogue scrolls underneath as one continuous wall. Each song is one compact group and all selected versions remain adjacent with V1/V2/V3 markers; complete groups wrap together to fill each row.

## v5.15 player-first pass

- Homepage is player + cassette wall only; narrative sections are not built or staged.
- Removed the duplicate pre-player now-playing header and the inspiration readout.
- Fixed hi-fi rack is ~560px tall on desktop, with a much larger active-track display.
- Spectrum, VU meters and interactive five-band EQ have substantially more vertical room.
- Two-line centred live lyrics remain permanently visible.

## v5.17 cassette cycle

Selecting a cassette now arms continuous random playback. At the end of a track the player chooses another playable song (avoiding the current song where possible), latches that cassette in the wall, plays a short mechanical insert sound, and continues automatically.

### v5.18 player behaviour

The player now randomises whole song groups on each refresh, includes a hardware-style shuffle-play button, keeps already-sung lyrics visually dark through pauses, and uses a corrected live EQ/analyser signal path. Positive EQ movement is an audible boost; peak protection is handled after the EQ rather than by reducing the whole mix. The spectrum uses higher FFT resolution so low-frequency columns respond independently.
