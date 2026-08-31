# Good Boy Records

Static GitHub Pages music showcase. The canonical interface is a late-night wall
of physical cassettes. Clicking a tape latches **that tape in its existing wall
position**, gives it the warm amber hardware glow, and starts playback. It does
not move the cassette into a second deck or scroll the visitor elsewhere.

There is deliberately no catalogue search box. This is a curated showcase, not
Spotify after a minor electrical fire.

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
file. `genre` drives the physical wall sections; versions with the same `title`
are kept directly beside each other. Missing genres fall into `Unclassified`.

Audio is matched to the YAML by filename. A render beginning with the YAML stem,
for example `dogtushya-v2_...flac`, belongs to `dogtushya-v2.yaml`. Legacy files
without the `-vN` suffix also have a title-based fallback.

If you deliberately drop several matching renders into `showcase/`, each chosen
render becomes its own cassette/version. CFG, STEP/STP and SEED values are read
from filenames when present.

Nothing outside `showcase/` is discovered or copied.

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
- The lower monitor rack is information/transport UI only. It does not contain a
  duplicate inserted cassette.
- Tape/Vinyl remains a persisted appearance switch using the same player state.
- Native MiniMax lyrics are displayed even when no separately timed LRC exists.


## Centre-player wall layout

The desktop wall is arranged around a centre transport that remains vertically centred while the collection scrolls. Each song appears once as a titled vertical stack. Its versions sit directly beneath that title, and each cassette gets only a small `V1`, `V2`, `V3` marker to its left. Genre sections remain the outer grouping.

The centre column is intentionally reserved for the sticky player, so cassettes pass on the left and right rather than disappearing underneath it. Lyrics and technical metadata live in a collapsible drawer on the player to keep the permanent centre hardware compact. On narrower screens the player becomes a sticky top-centred transport and the two wall lanes collapse responsively.

## Wall grouping and player EQ

The wall is generated as `genre -> song -> version`. Genre sections are visible
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
