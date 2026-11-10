---
keywords: [documentation, handbook, help, manual, guides, knowledge base, sidebar, navigation]
---

# Documentation pages
Documentation pages are pages written in markdown that your application serves at `/docs`, inside its own pages. They
come with a navigation of every page, the sections of the page beside it, and a search that finds a page by its title,
its sections and its keywords, despite a typo.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `DocsUtilities` | class | Gives each page its address, leads a link to another page's file to that page, and lists what the search finds |
| `DocsSite` | type | The documentation: where it is served, its first page and its pages in the order of the navigation |
| `DocsPage`, `DocsPageModule` | type, type | A page by its file, and what the file exports: the page, its frontmatter and its headings |
| `DocsFolder`, `DocsNavigationEntry` | type, type | A folder of pages under its title, and what the navigation lists: a page or a folder |
| `DocsSearchEntry` | type | What the search finds: a page or a section, with its address and where it is |

## Setting it up
The `docs` feature of a generated project brings the pages, their layout and their search. Add it to a project with:

```sh
zi add docs
```

It needs the `pages` feature, see [choosing the features](../application/project-layout.md#choosing-the-features). Its
files are in `src/templates/docs/`, and `src/controllers/docs.controller.ts` serves them. The navbar links to them.

## Adding a page
A page is a `.md` file in `src/templates/docs/pages/`, or in a folder of it, written as described in
[writing a page in markdown](./templating.md#writing-a-page-in-markdown). List it in `src/templates/docs/docs-site.ts`,
in the order the navigation shows it:

```ts
// src/templates/docs/docs-site.ts
import { DocsSite } from 'zibri';

import * as gettingStarted from './pages/getting-started.md';
import * as invitingYourTeam from './pages/guides/inviting-your-team.md';

export const DOCS_SITE: DocsSite = {
    basePath: '/docs',
    homePage: 'getting-started.md',
    title: 'Docs',
    navigation: [
        { file: 'getting-started.md', module: gettingStarted },
        { title: 'Guides', pages: [{ file: 'guides/inviting-your-team.md', module: invitingYourTeam }] }
    ]
};
```

The file gives a page its address: `guides/inviting-your-team.md` is at `/docs/guides/inviting-your-team/`, and the
`homePage` at `/docs/`. The first heading of a page is its title in the navigation. Every `##` and `###` heading is a
section, which the page lists beside it, the one being read marked. The `#` beside a heading copies the address of its
section.

The pages of the list are the ones served.

## Linking another page
Link a page by its file, relative to the page linking it, with the anchor of a section:

```md
See [inviting your team](./guides/inviting-your-team.md#sending-an-invitation).
```

The link leads to the address of the page, and GitHub follows it as well. Any other link stays as it is written.

## Finding a page
The search in the bar at the top finds a page by its title, a section by its heading, and both by another form of a
word, such as `invites` for "Inviting your team", or with a typo. `/` focuses it.

The `keywords` of a page's frontmatter are other words it is found by, such as the names a reader knows the topic by:

```md
---
keywords: [invitation, onboarding, members]
---
# Inviting your team
```

Once your application [declares its frontmatter](./templating.md#declaring-the-frontmatter), declare
`keywords?: string[]` with it.

The search fetches what it looks through from `/docs/search/v1/index.json`, the first time a reader types.

## Serving the documentation somewhere else
`basePath` of `DOCS_SITE` is where the pages are served, and the controller serves them there. `homePage` is the page at
`basePath` itself.

## See also
- [Templating](./templating.md) — writing a page in markdown, and the components its constructs render
- [Project layout](../application/project-layout.md) — the features of a generated project
