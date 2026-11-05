# Code style

Conventions for every package in this repository. Read this before your first change.

Changing `packages/tsx`? Read [its goals](./packages/tsx/GOALS.md) first: they are what every change to
the compiler is measured against.

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
- [Messages for the user](#messages-for-the-user)
- [The documentation](#the-documentation)
- [Tests](#tests)

# The linter decides most of it

Casing, import order, line length, member ordering and required JSDoc are all rules, not prose.
Run `npm run lint -w <package>` and `npm run typecheck -w <package>` before you open a pull request.
The typecheck is the only thing that checks the tests' types: the builds leave tests out, and jest
only transpiles them.

**Warnings are errors.** Every package runs `eslint --max-warnings=0`, so there is no such thing as a
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
| `.instance-options.ts` | What every instance of the `.cluster.test.ts` beside it boots with |

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
`PostgresSqlUtilities`, `StartedTestServer.reInit()`, `Percentage`.

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
finding, a past bug, or how a specific data source implements something.

**Inline `//` comments are not published, and are where the reasoning goes.** Why this approach and
not the obvious one, what was tried and failed, which invariant a line is holding up. Write them for
whoever has to change this in a year.

Comment density matches the surrounding file. A comment restating the code is noise; a comment
explaining a decision is the most valuable line on the screen.

# Messages for the user

**A validation message says what the value needs to be.** It is only read when the value is not that,
so a rule stated as a fact is false for the one value it is shown for. "A password has at least 15
characters" is what the password does not do; "A password needs to be at least 15 characters long" is
what its author has to change.

**"needs to" is the one wording of a requirement.** Not "has to", "should" or "must", and not the plain
present ("An externalId is a string"). A problem reported under a key starts at the verb, since the key
is its subject: `needs to be at most 5`.

**A fact about what was refused stays a fact**, as long as it is true of that value: `is required`,
`The role 'admin' does not exist`, `The filter cannot be read at "x"`.

# The documentation

`packages/zibri/docs/` is for people using the framework, and it has its own rules: read
[DOCS_STYLE.md](./DOCS_STYLE.md) before you write or change a page.

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
| `test:cluster` | `*.cluster.test.ts`, in band |
| `test:benchmark` | `*.benchmark.test.ts`, in band: timings reported against a `*.baseline.json` beside each suite, never failing |
| `test:benchmark:compare` | `test:benchmark` on your checkout and on `release`, in turns; fails on an operation that got slower |
| `test:heavy` | Long-running suites, in band |

CI runs every one of them: `test:ci` runs all but the benchmarks, which a job of its own runs through
`test:benchmark:compare`.

**A slower operation fails the build, measured against the release.** `test:benchmark:compare`
builds `origin/release` in a worktree beside your checkout and runs the benchmarks on both, four
times each, in turns on the same machine. An operation whose median is more than 1.3× the release's
fails it. Run `git fetch origin release` first. When a slowdown is worth it, add it to
`packages/zibri/benchmark-allowances.json` as `{ "against": "<release version>", "name": "<operation>",
"ratio": 1.6, "reason": "..." }`. It counts until that release is replaced, and the comparison names
the allowances that no longer apply.

**What a deployment weighs is held to a limit.** The cli's docker suite fails when the generated
project's bundle, `dist` or pruned `node_modules` outgrows
`packages/cli/src/__testing__/deployment-size-limits.ts`. Raise the limit in the change that makes it
grow, and say why beside it.

**Recorded baselines are your own machine's, never committed.** `ZIBRI_BENCHMARK_UPDATE_BASELINE=1`
(or `ZIBRI_DEPLOYMENT_UPDATE_BASELINE=1` for the deployment) records the run as your `*.baseline.json`,
which later runs are reported against.

**Most suites need a container runtime.** `startTestServer()` starts Postgres and ValKey through
testcontainers, so they need Docker or Podman running.

**Share cases rather than copying them.** A behaviour that has to hold on several data sources goes
in a `.cases.ts` file exporting a `describeX(name, () => repository)` function, and each data
source's `.test.ts` calls it. Two stores answering the same assertions differently is a whole class
of bug this repository keeps finding.