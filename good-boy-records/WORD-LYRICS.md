# Word-timed lyric sidecars

Good Boy Records **consumes** word-timing files but does not generate them. The heavy WhisperX/Demucs alignment tool lives outside this Git repository.

For:

```text
showcase/pity-pawty-v2.flac
```

the optional sidecar is:

```text
showcase/pity-pawty-v2.lyrics.json
```

The format remains `gbr-word-lyrics-v1`. New aligner sidecars also contain a quality gate:

```json
{
  "format": "gbr-word-lyrics-v1",
  "stats": {
    "coverage": 0.846
  },
  "quality": {
    "rating": "fair",
    "review_required": false,
    "approved": false,
    "usable_for_live_lyrics": true
  },
  "lines": []
}
```

The external aligner defaults to requiring review below 80% direct-match coverage. A low-confidence sidecar is still copied into the generated site, but the browser will **not** use its word-level karaoke timing unless it has been explicitly approved. Until then the normal line/raw lyric display remains active.

This means a difficult track can safely produce:

```json
"quality": {
  "review_required": true,
  "approved": false,
  "usable_for_live_lyrics": false
}
```

without publishing interpolated timing as if it were word-perfect.

After listening through the sidecar, use the standalone aligner's `APPROVE.bat`. Rebuild/push the site and that sidecar becomes eligible for live word highlighting.

During a normal site build, `tools/import_showcase.py` validates matching sidecars and copies them to `data/live-lyrics/`. The catalogue stores only a small URL pointer. The browser fetches the sidecar only when the cassette is selected.

If the file is absent, malformed, awaiting review or fails to load, normal lyrics are used instead. Audio playback never depends on the timing file.
