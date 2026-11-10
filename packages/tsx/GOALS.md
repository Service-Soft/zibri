# Goals of zibri-tsx

What this compiler is for, and the rule every change to it is measured against. Read this before
you change anything in `semantics/` or `codegen/` of `packages/tsx-compiler`, or anything of either package that
decides what a rendered page holds.

# The guarantee

**Code of the server cannot reach the browser.** Not by tree shaking, not by authors being careful:
the client script is printed from the template's own source, and the compiler never reads a module
a template imports. An `index.ts` that re-exports a secret beside the enum a template uses cannot
put that secret into the page, because nothing of that file is ever in the page.

This is the reason the package exists instead of an existing TSX dialect. A feature that weakens it
is not a trade-off to weigh against convenience. Without the guarantee, there is no reason left to
use this compiler.

# What reaches a page

The page is everything the browser receives from a render:
- the html the server renders
- the client script: the framework hooks, the `?client` vendor bundles, and text printed from the
  template's own AST - the body statements client code reads, the handlers, the function props
- the values written into the page for that script: serialized props, values a handler captures,
  and props built on the client

Code crosses only as the template's own source. A statement client code reads is re-run in the
browser, never evaluated on the server and written as a literal; so a statement that reads an import
is refused (`ZTSX003`), and `const x = MaskUtilities.mask(value)` compiles only while `x` stays on
the server, in the markup. A name client code reads from outside the component is one of the
browser's globals, a `?client` global, a global the template declares, or a hook (`ZTSX009`).

Values cross in three places, all narrowed to the fields client code reads:
1. **Props**, which the caller passes into the component function.
2. **Captures**: a loop variable or block local a handler reads, snapshotted at render time.
3. **Initial state.** The argument of `useState` runs on the server and never reaches the client script, whatever it
   reads. Its result is written into the page, narrowed to the fields client code reads. Like a prop or a capture, it is
   what the author wrote: `useState(mask(email))` writes the masked text, and `useState(config)` writes as much of
   `config` as client code reads.

All are what the author wrote: a prop at the call, a capture in the handler, an initial value in `useState`. The
compiler does not trace where the value came from.

**State across components.** A state handed to a nested component is a reference to it. Its value is written once,
as its initial value. An expression handed to a nested component that reads state, as a prop or through
`provideContext`, is client code of the parent, narrowed like any other. The argument of `useInput` and
`useWritableInput` runs on the server like the argument of `useState`: when it is a state, or such an expression, of a
component above, the page gets the reference to it, and otherwise the value, narrowed to what client code reads of it.

**Refs** (`useRef`, `useRefs`) cross as neither. A ref writes a stamp on an element and nothing else. The
stamp identifies the element within the page, and holds no value of the server. The handle is created in
the browser by the template's own source.

**Markup rendered in the browser.** A conditional or a list whose condition or items read state is rendered again in
the browser when the state changes, by code printed from the template's own markup. What it reads crosses like any
other client code, narrowed to what it reads.

**Templates.** A component, or `children` a component places, inside such markup is html the browser cannot build, as
it comes from another file. The server renders each branch and row holding one once more into a `<template>`, which the
browser copies. A template is html the server renders, like the rest of the page, and holds no code. It holds no value
reading a state or the row either: those are left out of it, and the browser writes them into the copy. A value reading
neither is the server's, rendered the same into every copy. The components in a template are instances like any other,
whose setup data is narrowed like any other. What a branch not shown renders is in the page, as a user can change a
state.

**Markdown pages.** A `.md` or `.mdx` file is printed as a template, which is then compiled like any other: the
guarantee holds for the printed template, as it does for one written by hand. Its markdown is markup the server
renders, and holds no code. The import and export lines, `{}` expressions and JSX elements of an `.mdx` file are
printed into the template as written, and checked like the source of any other: a handler on an element is client code
of the page.

The component a markdown construct renders, such as `heading`, is chosen while the page renders: from the
`components` prop, then from the `MdxComponentsContext` a component above or the render provides, then the plain
element. The mapping is a value of the server, which the printed template reads on the server only. The frontmatter is
an export of the module, which the page does not render.

**Markdown at runtime.** `<Markdown source={...}/>` of zibri renders markdown the server gets while it runs, such as
from a database, in an application that switches it on. Its source is a value of the server, and it is never compiled:
it is markdown alone, without the JSX, expressions and imports of an `.mdx` file, so nothing of it is code. Each
construct renders the component a `.md` page renders for it, with the same props, chosen the same way, and its text is
escaped like any text of the page. What reaches the page is the html those components render, and the props their
client code reads, narrowed like any other prop. Html in the source is a mistake only the render can see.

**Contexts a render provides** (`contexts` of `renderPage`) are the values a component around the page would provide
with `provideContext`, and cross like those.

**Effects** (`useEffect`) cross as neither. The effect and its list are client code, printed from the template's own
source like a callback of `onClient`. The server render drops the call, so neither runs while the server renders.

# How it is held

- **No module resolution.** The compiler runs a single-file program with `noResolve`. There is no
  mechanism by which another file's code could be emitted.
- **`ZTSX003`, `ZTSX008`, `ZTSX009`** check every name the emitted client code reads.
- **The independent script check** parses the finished client script again, on its own, so what
  reaches the page never depends on the analysis above being right.
- **Reachability by symbol** ships only the declarations client code reads, `onServer` callbacks,
  the arguments of `useState`, `useInput` and `useWritableInput`, and prop defaults left out.
- **Projection** writes only the fields client code reads from a prop, a capture or an initial state, through
  aliases, destructuring, rests, loops and array callbacks.

**The tests that hold it** are in `codegen/client/server-code-isolation.test.ts` of `packages/tsx-compiler`, under "what a page
receives from a template". They run a template all the way through: they compile it with every check,
render it against a real server module, and search the finished document.

# What is the author's

A *value* of the server reaches the page in exactly one way: the author hands it to client code in
the template's own source, and the render writes as much of it as that code reads.

- `env.providers.map(p => <button onClick={() => login(p)}/>)` writes `p` whole, because the handler
  passes it on whole. `login(p.clientId)` writes `clientId` and nothing else.
- `<Login provider={p}/>` is the same through a prop, when the child's client code reads `provider`.
- A context default from a `.ts` file (`createContext(environment)`) is the same value arriving
  differently; what the page gets is still decided by the handler that reads it.

This is deliberate on the author's side, the same act as passing a value into the component, and the
compiler does not second-guess it. A closed component scope, where a component may
name nothing but its props and `?client` imports, would refuse all three; it was built that day and
taken out again, because it also forbids every utility, enum and helper in templates while the thing
it refuses is written by hand. The cases are kept in "the value a handler is handed", so a change to
how much is written shows up there.

# Changing it

**Judge a change by what crosses, and how.** Code crosses as the template's source; a value crosses
as a prop or a capture. Ask which one a change touches, and whether it adds a third way.

**A new way into a component or onto the page changes this file first.** That includes a new hook, a
new kind of value written into the page, a new place a value may come from, or anything else the
render hands to a component. It is a decision for the maintainer, not an implementation detail. Write
it down here before you build it.

**Narrowing a channel does not make it legitimate.** Before you make a way in safer, ask whether it
should exist at all.

**Every way in has a case in "what a page receives from a template"**, asserting on the finished
document. A case shows what stays out, or states what crosses and how much of it.

**Name the threat before building a guarantee.** The closed scope above was built against "a value
of the server", when the threat was "code of the server compiled into the page". Those differ by
everything a template is allowed to import.

**A mistake is reported as early as it can be known**: by the type check, then by the compiler, then while the server
renders, and the browser last. One only the render can see calls `reportRenderMistake`: it throws in `development`, so
a test rendering it fails, and in `production` it is logged and the page renders with the broken part degraded.

# Decided against

What the client side of a template does not have, and why, so it is not proposed again without a new reason.

- **React's model.** A component runs once: it renders on the server, and its setup runs once per instance in the
  browser. Re-running it needs its markup in the client script, so every import the markup reads would hit `ZTSX003`,
  every prop it reads would be written into the page, and a component imported from another file could not be rendered
  at all, as the compiler reads one file. State is followed by bindings per expression instead.
- **The hooks that exist because React re-runs components:** `useComputed`, `useCallback`, `useMemo` as a cache,
  `useTransition`, `useDeferredValue` and `useLayoutEffect`. A binding reaches state through a local function, and with
  no dependency graph a computed value has nothing to do.
- **A named global store**, such as `useStore('metrics:snaps', [])`. Props and contexts carry a state between
  components.
- **A spread of a state or a row onto a component inside markup the browser renders**, such as `<Card {...item}/>` in a
  list. It is `ZTSX016`, and the props are written by name. The page follows each prop by its name, and a template is
  rendered without the row, so the server would have to take the names from the component's own lists, which leaves
  open what client code reading its props as a whole gets.
- **Client code shared across files** is not built: client code cannot read an import, and what works instead is a
  `?client` package, a value computed on the server and handed over, a script the page loads which the template
  declares, or a copy in each component. A client module, compiled and checked on its own and loaded as an asset of its
  own, is the shape it would take if a real case needs it.
