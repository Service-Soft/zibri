# Code style

Conventions for every package in this repository. Read this before your first change.

Where this and the surrounding code disagree, this wins — the code predates some of it. Where this
and the linter disagree, the linter wins and this file is wrong; open an issue.

# Table of Contents

- [Code style](#code-style)
- [Table of Contents](#table-of-contents)
- [The linter decides most of it](#the-linter-decides-most-of-it)
- [Naming](#naming)
  - [A function's verb says what it costs to call it.](#a-functions-verb-says-what-it-costs-to-call-it)
  - [Names should be precise](#names-should-be-precise)
- [Files](#files)
- [Shape of the code](#shape-of-the-code)
- [Types](#types)
- [Comments and JSDoc](#comments-and-jsdoc)
- [The documentation](#the-documentation)
- [Tests](#tests)

# The linter decides most of it

Casing, member ordering and required JSDoc are lint rules (oxlint), layout and import order are the
formatter's (oxfmt), and spelling is cspell's - all three are tools, not prose. Run
`npm run lint -w <package>` and `npm run typecheck -w <package>` before you open a pull request;
`npm run lint:fix -w <package>` formats and applies the fixes the linter can make.
The typecheck is the only thing that checks the tests' types: the builds leave tests out, and vitest
only transpiles them.

**Warnings are errors.** Every package runs `oxlint --max-warnings=0`, so there is no such thing as a
warning you can leave behind.

If a rule fires, try to fix the code — enumerate the
missing switch cases, write the missing JSDoc, narrow the type. A rule that genuinely needs to be disabled should always be the last resort.

Nothing the linter already checks is repeated below.

# Naming

## A function's verb says what it costs to call it.

| Verb | Use it when |
|---|---|
| `getX` | The value is already there and you are handing it over |
| `findX` / `findXs` | You are looking for it, and it may not be there |
| `resolveX` | Work happens before you can answer — a lookup, a computation, a round trip |
| `validateX` | You are checking something, and the caller learns nothing except that it was wrong |

`getX` and `resolveX` divide on effort, not on where the value lives. A getter that walks an
inheritance chain or reads a file is a `resolveX`, however cheap it looks from the outside.

**`validateX` is the only verb for checking.** Not `assertX`, not `requireX`, not `ensureX`, not
`refuseX`, not `checkX` — they all describe the same function, one that returns nothing and throws
when it has something to say, and five names for it means nobody can search for the checks.

## Names should be precise
Always prefer `calculateInvoiceTotalNet` over `calculateTotal`. The only restriction to this is when the function is already grouped by something:

`InvoiceUtilities.calculateInvoiceTotalNet` is unnecessary verbose, here it should be `InvoiceUtilities.calculateTotalNet`.

# Files

**One exported concept per file**, named after it in kebab-case, with a suffix saying what kind of
thing it is:

| Suffix | Holds |
|---|---|
| `.model.ts` | A class or type describing data — an entity, a metadata shape, an options object |
| `.interface.ts` | An interface and its DI token |
| `.service.ts` | An injectable service |
| `.utilities.ts` | A class of related static methods |
| `.function.ts` | A single exported function that belongs to no class |
| `.decorator.ts` | A decorator |
| `.error.ts` | An error class |
| `.enum.ts` | An enum |
| `.type.ts` | A standalone type alias |
| `.test.ts` | Tests for the file of the same name |
| `.cases.ts` | Test cases shared by several `.test.ts` files |

`.cron-job.ts`, `.cache.ts`, `.rate-limiter.ts`, `.middleware.ts`, `.worker.ts` and `.registry.ts`
follow the same idea for their own kinds.

**A test sits next to what it tests.** `repository.ts` and `repository.test.ts` share a directory.

# Shape of the code

**Group related functions into a utility class with static methods**, not a directory of loose
exports. Put the entry points first and the steps they are built from below as `private static`. A
standalone `.function.ts` is for something that genuinely belongs to no group — and when a second one
appears next to it, they become a class.

**A service is a provider behind an interface.** A service the framework ships comes with an
`XServiceInterface`, and a `ZIBRI_DI_TOKENS` token whose default provider is the class. Everything
reaches it through the token, never by its class, so an application can replace it.

**Setup at boot goes in `onAppInit`.** Implement `OnAppInit`, and the application calls it while it
starts; no `init` method that some other class has to remember to call. A default provider with the
hook is built in every application, so `onAppInit` first finds out whether the application uses the
feature at all (`TwoFactorService` reads `twoFactorMethods`), and checks nothing when it does not.

**Extend an existing helper rather than adding a sibling.** Search `src/utilities/` and
`src/__testing__/` for the concept, and read the matching page in `packages/zibri/docs/`, before you
design anything. Most of what a change needs already exists: `UUIDUtilities.generate()`,
`TypeOrmUtilities`, `StartedTestServer.reInit()`, `Percentage`.

**Do not loop per entry where one call would do.** A method that runs per row, per entity or per
request is the wrong place for work that can be done once. Where several things genuinely must
happen, use `Promise.all` or `PromiseUtilities.allChunked`, and extend the existing method to take
the whole list instead of calling it in a loop.

**Fix the cause.** A guard that hides a wrong value, a retry around something that should not fail, a
second way to say what is already declared — each leaves the defect in place and adds a thing to
maintain. If the real fix is out of scope, say so and leave the problem visible.

**When a setting has two legitimate answers, make it required.** No `?? sensibleDefault` for a
security or policy choice: whichever value the framework picks silently, "you forgot to say" becomes
indistinguishable from "you said this". A required option asks once, in the one place it can be
answered, and the compiler asks it rather than a startup warning nobody reads.

**Touch only what your change needs.** Do not reformat, rename or improve adjacent code. Remove
imports and variables *your* change orphaned; leave pre-existing dead code alone and mention it.

# Types

**Be strict.** No implicit `any`, no widening a type to make a call compile.

**`as SomeType` means the model is wrong.** Before writing a cast, find the shape that does not need
one — usually a type that was never split. A write-time type and a read-time type differ often enough
to have a pattern: see `JwtCredentials` and `JwtCredentialsCreateData`.

**`as never` is never the answer, least of all in a test.** A cast in a test means the test data does
not match what the code takes, which is the thing worth knowing.

**Before replacing an `any`, find out why it is there.** Some are load-bearing: a type parameter in
both a return and a parameter position is invariant, and under `strictFunctionTypes` `any` is then
the only type assignable in both directions. Report what would make the reason obsolete — usually a
model change — rather than substituting `unknown` and seeing whether it compiles.

**Prefer a named type to an inline one**, and declare the type of every non-trivial local.

# Comments and JSDoc

These are two different audiences and the split is strict.

**JSDoc is published.** Typedoc emits it for every exported symbol, and the people reading it have
never seen this repository. It states what the thing does and what a caller gets. It never names a
finding, an evaluation section, a past bug, or how a specific data source implements something.

**Inline `//` comments are not published, and are where the reasoning goes.** Why this approach and
not the obvious one, what was tried and failed, which invariant a line is holding up. Write them for
whoever has to change this in a year.

Comment density matches the surrounding file. A comment restating the code is noise; a comment
explaining a decision is the most valuable line on the screen.

# The documentation

`packages/zibri/docs/` is for people using the framework, and it has its own rules.

**Say what is.** Not what changed, not what something used to do, not what a feature is *not*, not
why a rule exists, not what happens underneath.

**Only name concrete implementations as examples.** Describe for example how transaction can be created, never how Postgres or ValKey implement it internally. If
it is ever relevant which store is underneath, the abstraction is leaking and that is the bug.

**Plain, short, second person.** Match the intro paragraphs of the
existing pages rather than writing an essay.

**One topic per page.** When two pages start carrying content belonging to a third, write the third
and link to it. A table listing an API is complete or it is wrong.

Anything worth documenting is documented in the same change, or written down as a TODO.

# Tests

**Test the whole thing working, not each piece alone.** Bugs live between the parts. Default to
`startTestServer()`, which boots a real application, a real DI container and a real database.
Focused unit tests are right for genuinely pure logic — add them as well, not instead.

**Use the least mocking you can.** When a real dependency breaks under the test tooling, fix the
tooling: a mock permanently diverges the test from what ships. Mock only a boundary that cannot run
in-process at all, such as `process.exit`.

**Never record a bug as an accepted difference.** Allowlists and golden snapshots exist for
divergence somebody chose on purpose, never for a gap you found. Tests exist to show bugs; a suite
that is never red is not a suite that is passing. Leave it red and report it.

**Run tests through the npm scripts**, which exist because of resource contention rather than taste:

| Script | Covers |
|---|---|
| `test:normal` | Everything except the below |
| `test:evaluation` | `*.evaluation.test.ts`, red by design while their findings are open |
| `test:cluster` | `*.cluster.test.ts`, in band |
| `test:benchmark` | `*.benchmark.test.ts`, in band: timings reported against `src/__testing__/benchmark/baseline.json`, never failing |
| `test:heavy` | Long-running suites, in band |

**Most suites need a container runtime.** `startTestServer()` starts Postgres and ValKey through
testcontainers, so they need Docker or Podman running.

**Share cases rather than copying them.** A behaviour that has to hold on several data sources goes
in a `.cases.ts` file exporting a `describeX(name, () => repository)` function, and each data
source's `.test.ts` calls it. Two stores answering the same assertions differently is a whole class
of bug this repository keeps finding.