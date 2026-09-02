---
tab: Notes
title: Sleeve notes
order: 3
---

*Placeholder — replace this file with your own words.*

## Adding your own folders

Drop a Markdown file into `content-source/folders/` and rebuild:

```
python tools/build_catalogue.py
```

Each file needs frontmatter:

```
---
tab: Notes
title: Sleeve notes
order: 3
---
```

`tab` is the label down the side, so keep it short — about twelve characters
before it starts to crowd the others. `order` sorts the tabs top to bottom.

The body takes the usual Markdown: headings, lists, tables, quotes, links,
`inline code` and fenced blocks. Delete a file to remove its tab; remove them
all and the tabs disappear entirely.
