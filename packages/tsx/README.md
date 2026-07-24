# zibri-tsx

A hand-written TSX compiler for Zibri **page** templates.

It parses a strict TSX dialect into its own AST (no TypeScript compiler API, no `preact` — zero
runtime dependencies), then compiles each component at build time into:

- a fast server `render(props) => string` function that owns HTML generation, and
- a client `<script>` template that restores imperative interactivity **without hydration**.

This replaces the runtime `Function.prototype.toString()` + regex approach in
`packages/zibri/src/preact`. See [`docs/PREACT-TEMPLATING.md`](./docs/PREACT-TEMPLATING.md) for a
description of that original solution, which this package exists to supersede for pages. Emails
continue to use the preact path for now.

## Status

Work in progress. Built in phases: lexer → parser/AST → semantics → server codegen → client
codegen → runtime → build integration. Each layer ships with exhaustive tests.

## Public API

```ts
import { compile } from 'zibri-tsx';

const result = compile(source, { fileName: 'home.tsx' });
// result.diagnostics, result.serverModuleCode, result.clientScript, result.meta
```
