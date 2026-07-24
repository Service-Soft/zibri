# Zibri Preact Templating

A server-side templating system built on `preact` + `preact-render-to-string` that produces
plain HTML **and**, for pages, a hand-compiled `<script>` that restores a small amount of
client-side interactivity — **without hydration** and **without shipping a client framework**.

## Why it exists (design goals)

- **No hydration.** Hydration serializes the whole component/prop tree into the page, which makes
  it easy to *accidentally leak server-side secrets* into the browser. This system never does that.
  Only values that client code explicitly references are emitted.
- **No hand-written client JS.** Author interactivity in the same strict, type-checked TSX as the
  server render. The framework extracts it and generates the browser script for you.
- **Strict and small.** The generated script contains only: the referenced props, the event
  handlers, the `onClient` bodies, a few inlined helper hooks, and a bootstrap that re-attaches
  handlers to the already-rendered DOM.

## Public API

| Export | Purpose |
| --- | --- |
| `PreactUtilities.renderPage(Component, props?)` | SSR → HTML **plus** an inlined client `<script>`. |
| `PreactUtilities.renderEmail(Component, props?)` | Pure SSR → HTML. **No** script injection (emails must be inert). Also un-escapes MSO/Outlook conditional comments. |
| `onClient(fn)` | Runs `fn` only in the browser. Its body is what actually gets compiled into the page script. |
| `onServer(fn)` | Runs `fn` only on the server; stripped from client output. |
| `$t` / `$ts` | Localization: translation token / resolved string. Dependency-free reimplementations that are inlined into the client script. |
| `$f` | Locale-aware formatting (`date`, `time`, `dateTime`, `price`, `percent`), inlined from `$fHookCode`. |
| `generateClientScripts(glob?)` | **Build-time** step. Resolves `?client` package imports to browser bundles under `assets/public/vendor` and writes `manifest.json`. |
| `PreactComponent<T>` / `PreactEmailComponent<T>` | `(props: T) => JSX.Element` component types. |
| `validateEmailTemplates()` | **Stub / TODO — does nothing yet.** |

Components are wired up via `jsx: "react-jsx"`, `jsxImportSource: "preact"` and compiled by
`ts-loader` (see `packages/sandbox/webpack.config.js`). At render time the components are already
**compiled JS**, which is why the parsers below look for `_jsx(`/`jsx_runtime`/`zibri_1.onClient`.

## How `renderPage` works

The core trick: the component's *source* is read back at runtime via `Function.prototype.toString()`
and transformed by a set of hand-rolled, string/comment/template-aware parsers
(`preact.utilities.ts`, `string-aware-replace.function.ts`).

1. **Split the source** into params text and body text (paren/brace matchers).
2. **Body before the top-level `return`** — the imperative part (variable decls, local functions,
   `onClient(...)` calls) is kept. Every JSX `return` is replaced with `break <label>;` so control
   flow is preserved inside a labeled block instead of returning a VNode.
3. **Rewrite framework hooks** — `zibri_1.onClient` → `onClient`, etc. — and inline the hook
   function bodies (`onClient`, `onServer`, `$t`, `$ts`, `$f`) at the top of the script.
4. **Rewrite `?client` imports** — `chart_js_client_1.Chart` → `Chart`, because the vendored bundle
   exposes globals via a `<script src>` tag.
5. **Inline props** — serializable props become `const __PROPS = {...}` (JSON, `<` escaped) and are
   destructured to locals; **function props** are emitted as `const name = <source>`.
6. **`PreactCollector.walk(vnode)`** traverses the rendered tree:
   - **Host elements** (`div`, `button`, …): each `on*` handler is registered, given an id, and the
     element is stamped `data-ssr-handlers="h1:click|h2:input"`. Handler source is stored.
   - **Function components**: the component is *rendered*, a `NestedComponentEntry` is recorded with
     a unique instance prefix (`button0_`), its prop bindings are resolved (simple handler
     delegations, inline function props, static values), then the node is replaced by its rendered
     output and walking continues. All of the component's declared names get the prefix so multiple
     instances don't collide.
   - **Loops**: `Array.prototype.map` is monkey-patched during the walk to capture each item's value
     as *loop context*, so `tabs.map(tab => <button onClick={() => changeTab(tab.id)}/>)` can bake
     the correct `tab` into each reattached handler via an IIFE.
7. **`renderToString`** produces the HTML.
8. **Vendor scripts** — for every component that used a `?client` package (looked up in
   `manifest.json`), a `<script src="/assets/vendor/<kebab>.js">` is injected into `<head>`.
9. **Assemble the script** as nested labeled blocks (`root_: { … button0_: { … } }`) so nested
   component code can close over parent-scoped variables, followed by the **handler reattachment**
   IIFE: it scans `[data-ssr-handlers]`, splits the directive, and `addEventListener`s each
   reconstructed function.
10. **Localization placeholders** (`TRANSLATIONS_PLACEHOLDER`, `LOCALE_CODE_PLACEHOLDER`,
    `LOCALE_FORMAT_OPTIONS_PLACEHOLDER`) are replaced with real data, gated by heuristics on how
    often `$t`/`$ts`/`$f` appear.
11. **CSP** — the injected `<script>` gets the request's `nonce` if one is present.
    Any `</script>` in emitted code is escaped to `</script>`.

## What the client can do

- **Event handlers** on host elements (`onClick`, `onSubmit`, `onChange`, …) — re-attached to the
  SSR'd DOM.
- **`onClient` bodies** — arbitrary imperative browser code (DOM queries, listeners, timers).
- **Passing handlers/functions as props** to nested components, with prop defaults and destructuring.
- **`.map` loops** with per-item handler capture.
- **Third-party browser libraries** via `pkg?client` imports (e.g. `chart.js?client`,
  `socket.io-client?client`), auto-bundled and referenced as globals.
- **Localization & formatting** in both server and client code via `$t`/`$ts`/`$f`.

## Strictness / safety properties

- No hydration and no automatic tree/prop serialization → far smaller secret-leak surface.
- `onServer` code never reaches the client.
- Async components are **rejected** (root and nested) with a helpful error.
- Components **must accept a single props object** — validated, throws otherwise.
- `</script>` is neutralized; props are JSON-encoded with `<` escaped.
- CSP nonce support for the inlined script.

## Missing / incomplete / fragile

**Not implemented**
- `validateEmailTemplates()` is an empty TODO stub.

**No client reactivity**
- There is no `useState`/`useEffect`/signals equivalent and no declarative re-render. All client
  interactivity is *imperative* DOM manipulation inside `onClient` (see `socket-io-test.tsx`,
  `tab-bar.tsx`). Preact's own hooks are **not** available on the client.
- Handlers only re-attach to elements that existed in the SSR HTML (`data-ssr-handlers`). Elements
  created at runtime via `createElement` must wire up their own listeners manually.

**Reliance on `Function.prototype.toString()` + hand-rolled parsing**
- The whole page pipeline parses *compiled* JS with bespoke brace/return/rename logic and regexes.
  This is inherently fragile: minification, a different JSX transform, or unusual code shapes can
  break it. It assumes `ts-loader`-style unminified output with `_jsx`/`jsx_runtime` markers.
- Handler-delegation detection (`extractDelegateName`) only recognizes simple call and
  single-member-call shapes (`() => foo()`, `e => foo(e)`, `() => obj.foo()`). More complex handler
  props passed to nested components may not resolve.
- Loop capture only hooks `Array.prototype.map` — not `for`, `forEach`, `flatMap`, etc.
- Variable renaming is regex/word-boundary based (`applyRenameMap`), which can misfire on edge cases.

**Serialization limits**
- Props crossing to the client must be JSON-serializable (functions are the only exception, emitted
  by source). `JsonUtilities.stringify` only special-cases `bigint`→string; `Date`, `Map`, `Set`,
  class instances, and `undefined` semantics are otherwise lost/limited.

**Localization heuristics**
- Whether translation/format tables get injected is decided by occurrence counts of `$t`/`$ts`/`$f`
  (`> 3`, `> 2`). This is magic and could both over- and under-trigger; placeholder replacement is
  also string-based and would collide with user code containing the placeholder literals.

**Other**
- No source maps / debugging story for the generated client script.
- Component source is re-parsed on every render (mitigated in practice by controller-level caching,
  e.g. `StaticPagesCache`).
- No dedicated automated tests for the preact module were found.
</content>
</invoke>
