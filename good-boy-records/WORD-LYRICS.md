# Word-timed lyric sidecars

Good Boy Records **consumes** word-timing files but does not generate them. The
heavy alignment tool is deliberately separate from this Git repository.

For an audio file such as:

```text
showcase/pity-pawty/pity-pawty-v2_CFG-1.70_STEP-31_SEED-7.flac
```

the optional timing file must have the same stem:

```text
showcase/pity-pawty/pity-pawty-v2_CFG-1.70_STEP-31_SEED-7.lyrics.json
```

The accepted format identifier is:

```json
{
  "format": "gbr-word-lyrics-v1",
  "lines": [
    {
      "text": "It's my Paw tea",
      "start": 12.34,
      "end": 13.74,
      "words": [
        {"text": "It's", "start": 12.34, "end": 12.62},
        {"text": "my", "start": 12.62, "end": 12.88},
        {"text": "Paw", "start": 12.88, "end": 13.21},
        {"text": "tea", "start": 13.21, "end": 13.74}
      ]
    }
  ]
}
```

During a normal build, `tools/import_showcase.py` validates matching sidecars and
copies them to generated `data/live-lyrics/`. The catalogue stores only a small
URL pointer. The browser fetches the file on cassette selection rather than
embedding every song's word grid into the homepage.

If the sidecar is absent, malformed or fails to load, normal line/raw lyrics are
used instead. Audio playback never depends on this file.
