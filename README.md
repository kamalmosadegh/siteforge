# SiteForge

![TypeScript](https://img.shields.io/badge/typescript-5.x-blue)
![Node](https://img.shields.io/badge/node-22-green)
![License](https://img.shields.io/badge/license-MIT-green)
![Dependencies](https://img.shields.io/badge/dependencies-none-brightgreen)

SiteForge is a fast drop-in for a small static site generator: it builds exactly the same output tree — every page, index, tag page and build report, byte for byte — in about a third of the reference implementation's CPU time. One dependency-free TypeScript file holds the whole build; a tiny driver reads the cases and writes the answers.

## What it does

Given one site — its settings, its templates and its Markdown sources — SiteForge produces the site's output tree: each page's `index.html`, the paginated index, every tag page, the tags index, the static files and a `build-report.txt` listing every refusal, draft, broken link and shadowed file. Its front matter, template dialect, Markdown subset, slug rule and report are the reference generator's own: strict `key: value` front matter with per-key grammars, `{{ }}`, `{{{ }}}`, `{% for %}`, `{% if %}` and `{% include %}` templates with standalone-tag lines, ATX headings with unique ids, fenced code, blockquotes, flat lists and the reference inline rules for code spans, emphasis, strong and links.

## How it gets faster

- **Plain text moves in bulk.** The inline renderer finds the next special character with one regex search and copies everything before it in a single slice; characters are escaped one at a time nowhere.
- **Markdown is read with character tests, not a regex per line.** Block starts — fences, headings, breaks, quotes, lists — are recognised by direct checks on the line's first characters.
- **Slugs are cached.** Titles, headings and tag names repeat across a site; each distinct text is slugged once.
- **Templates compile once into small functions.** A template's node tree becomes a JavaScript function that renders straight into a string, with loop variables as plain locals and includes resolved through a scope chain — no tree walking per render.

## Results

- **Identical output on every case**: 3 of 3 practice cases and 9 further cases from three independently drawn instances — every file byte-identical to the reference
- **About 3.3× faster than the reference** on CPU time over the practice set (about 190 ms against about 640 ms for the three cases, measured side by side on the same machine)
- **Deterministic**: two runs over the same set produce byte-identical output

## Run it

```sh
node main.ts
```

By default it reads cases from `/input/cases.json` and writes answers to `/output/answers.json`. For a local run, point it at any directory of the same shape:

```sh
SITEFORGE_INPUT_DIR=./practice/input SITEFORGE_OUTPUT_DIR=./out node main.ts
```

Node 22 runs the TypeScript directly — no build step, no dependencies, no network.

---

**Kamal Mosadegh** — Freelance Developer · Contact by email only: kamalmosadegh6977@gmail.com
