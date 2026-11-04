# Goals of zibri-tsx

What this compiler is for, and the rule every change to it is measured against. Read this before
you change anything in `semantics/` or `codegen/`, or anything that decides what a rendered page
holds.

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

Values cross in two places, both narrowed to the fields client code reads:
1. **Props**, which the caller passes into the component function.
2. **Captures**: a loop variable or block local a handler reads, snapshotted at render time.

Both are what the author wrote: a prop at the call, a capture in the handler. The compiler does not
trace where the value came from.

# How it is held

- **No module resolution.** The compiler runs a single-file program with `noResolve`. There is no
  mechanism by which another file's code could be emitted.
- **`ZTSX003`, `ZTSX008`, `ZTSX009`** check every name the emitted client code reads.
- **The independent script check** parses the finished client script again, on its own, so what
  reaches the page never depends on the analysis above being right.
- **Reachability by symbol** ships only the declarations client code reads, `onServer` callbacks
  and prop defaults left out.
- **Projection** writes only the fields client code reads from a prop or a capture, through aliases,
  destructuring, rests, loops and array callbacks.

**The tests that hold it** are in `codegen/client/server-code-isolation.test.ts`, under "what a page
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
