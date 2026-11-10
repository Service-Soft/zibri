---
keywords: [markdown, links, tables, code]
---

# Writing a page

A page is markdown, as GitHub renders it: headings, lists, tables, code blocks and alerts. Its first heading is its
title in the navigation, and every `##` and `###` heading is a section the page lists beside it.

## Linking another page

Link another page by its file, such as [adding a page](../getting-started.md#adding-a-page). The link leads to the
address of the page, and GitHub follows it as well.

## Showing code and tables

```ts
// src/greeting.ts
export const greeting: string = 'Hello';
```

| Construct | Written as |
|---|---|
| Heading | `## Heading` |
| Alert | `> [!NOTE]` |

> [!NOTE]
> The pages the list in `src/templates/docs/docs-site.ts` names are the ones served.
