# Good Boy Records v9.0

Full build based on the v8.2 workflow-rendering source.

## Changes

- Replaces the former right-hand documentation tabs with a top-mounted horizontal information rack.
- Page tabs are generated from Markdown front matter and sorted by `order`, so the planned ~10 pages need no hard-coded navigation changes.
- The selected page pulls down from beneath the fascia and overlays the player without changing audio state.
- Drawer height is resizable and persisted locally; double-clicking the resize handle resets it.
- Mobile keeps the same physical metaphor and horizontally scrolls the page tabs instead of wrapping them.
- Replaces flat list-only Markdown handling with indentation-aware nested lists.
- Reformats the Technology page so MiniMax components render as a real tree: Text Encoders, Diffusion Transformers and VAE, then individual model files.
- Fixes the ComfyUI viewer's multiline widget detection. Prompt-like widget names such as caption, lyrics, prompt, text and description remain multiline even when their value is empty.
- Empty caption/lyrics fields on `MiniMax Music 3 Encode` now render as full read-only text areas rather than tiny scalar rows.
- Existing workflow node positions, sizes, links, groups, colours and values remain source-driven.
- Includes the six current pages supplied on 10 September 2026 at orders 1, 2, 3, 4, 5 and 10.

## Validation

- Python syntax checks: PASS
- JavaScript syntax checks: PASS
- Static build: PASS
- Internal link check: PASS (5 references / 1 generated page in this media-empty source build)
- GitHub Pages staging: PASS
- Regression suite: 103 / 103 PASS
- Desktop visual inspection: PASS
- 390px mobile layout: PASS; page rail scrolls, document does not overflow horizontally
- MiniMax Music 3 Encode renderer check: PASS; caption and lyrics each render as multiline text boxes

## Media note

The archived v8.2 source used as the build base contains an empty curated showcase manifest and no showcase audio files. v9.0 therefore preserves that state rather than inventing catalogue content. Drop/copy the local `showcase` material into this source in the same way as the previous build, then run `BUILD-SHOWCASE.bat` or the normal Python build pipeline.
