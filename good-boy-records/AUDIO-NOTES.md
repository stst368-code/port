# Audio selection

Audio is deliberately curated.

The build never scans your MiniMax working folders. Only files placed under
`showcase/` can enter the website.

For a normal single-release song, place these together:

```text
showcase/
  your-song-v2.yaml
  your-song-v2.png
  your-song-v2.flac
```

A generated filename is also fine:

```text
  your-song-v2.flac
```

If more than one matching render is present, the importer treats that as an
intentional choice and creates a cassette for each render. If no matching audio
is present, the cassette remains visible but clearly reports that no selected
audio has been supplied.

FLAC is preferred when the same generation is present in more than one encoding.
