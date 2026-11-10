---
keywords: [introduction, overview, start]
---

# Getting started

The documentation of this application: pages written in markdown in `src/templates/docs/pages`, served at `/docs`.
Replace these pages with your own.

## Adding a page

Write a `.md` file in `src/templates/docs/pages`, or in a folder of it, and list it in `src/templates/docs/docs-site.ts`.
The list is the order of the navigation. The file gives the page its address: `guides/writing-a-page.md` is served at
`/docs/guides/writing-a-page/`.

## Finding a page

The search at the top finds a page by its title, the headings of its sections and the `keywords` of its frontmatter,
also by another form of a word or with a typo. Press `/` to start searching.
