# Good Boy Records — top pull-down page drawer v1

This replaces the *visual/navigation layer* for the current right-hand documentation tabs.
It is deliberately independent of the music player and does not change the supplied page content.

## Current pages detected

- 1: `About` — About Good Boy Records
- 2: `Origin` — Where'd the idea come from
- 3: `Tech` — The tools and tech used
- 4: `Music Workflow` — MiniMax Music 3 workflow
- 5: `Output Analysis` — Output Analysis
- 10: `Requests` — Requests

Orders 6–9 are simply unused at present. Do **not** create placeholder tabs.
When those Markdown files exist, sort by `order` and emit them exactly like the current six.

## Files

- `assets/css/gbr-page-drawer.css` — top rail, hanging hardware-style tabs, drawer, responsive behaviour.
- `assets/js/gbr-page-drawer.js` — open/retract/switch logic, Escape, backdrop close, keyboard tab navigation.
- `page-drawer-fragment.html` — working HTML generated from the six supplied page files.
- `prototype.html` — self-contained visual prototype.
- `pages/` — untouched copies of the supplied Markdown files.

## Integration into the existing static build

Keep the existing Markdown renderer. That is important because the site already owns custom constructs such as
`[spotify: ...]`, `[comfy-workflow: ...]`, and `[feedback-form: ...]`.
The new drawer should receive the **already-rendered HTML** for each page.

For each page, sorted by its front-matter `order`, emit:

```html
<button class="gbr-page-tab"
        data-gbr-page="SLUG"
        data-gbr-title="FULL PAGE TITLE"
        aria-controls="gbr-page-drawer"
        aria-expanded="false">
    TAB LABEL
</button>

<template id="gbr-page-template-SLUG">
    ...the existing renderer's HTML...
</template>
```

Then include the common drawer shell from `page-drawer-fragment.html` once.

Add to the page `<head>`:

```html
<link rel="stylesheet" href="assets/css/gbr-page-drawer.css">
```

Add just before `</body>`:

```html
<script src="assets/js/gbr-page-drawer.js"></script>
```

If your generated site uses a base path, pass these through the same URL helper already used for the other assets.

## Behaviour

- Top rail remains visible.
- A page tab drops the equipment drawer over the player rather than pushing layout down.
- Selecting another page changes the drawer contents without retracting it first.
- Selecting the active tab retracts it.
- `RETRACT`, Escape and the dimmed background also close it.
- Audio is not paused or touched.
- Ten or more tabs are safe: the rail becomes horizontally scrollable instead of wrapping into two ugly rows.
- Mobile uses the same physical metaphor, with a nearly full-width drawer.
- Reduced-motion users get effectively instant transitions.
- JS exposes `window.GBRPageDrawer.open(slug)`, `.close()`, `.current()` and `.isOpen()`.

## What to remove

Once this is wired into the real template, remove the old **right-hand page-tab container and its positioning CSS**.
Do not remove the underlying page parser/renderer. The content system was not the problem; its furniture was.
