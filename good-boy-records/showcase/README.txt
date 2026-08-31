DROP ONLY THE TRACKS YOU WANT ON THE PUBLIC SITE IN THIS FOLDER.

For each song, normally include:
  song-v2.yaml
  cover.png
  song-v2.flac

Generated names such as:
  song-v2_CFG-1.70_STEP-31_SEED-7.flac
are understood too.

You can create a subfolder per song if you prefer.
Nothing outside this showcase folder is scanned.

Recommended YAML fields for wall/player metadata:
  title: pity-pawty
  version: 2
  model: minimax H3
  state: active
  genre: pop
  inspiration: Melanie Martinez - Pity Party
  duration: 298
  cover: pity-pawty-v2.png
  caption: |
    ...generation prompt...
  lyrics: |
    ...lyrics...

Genre creates the wall section. YAMLs with the same title stay together as
adjacent versions inside that genre. Missing genre becomes Unclassified.
