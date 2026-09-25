# What's left

An index, not an argument. 124 findings are closed — two of them, [01 §M27](./01-data-layer.md) and
[05 §M5](./05-di-metadata-and-packaging.md), filed by this work rather than by the original
review — and 7 are partly closed with their residue named in place; roughly 47 are open. The chapters hold the detail, the reasoning and the rejected
alternatives — this file exists so that deciding what to do next does not require reading them.

Ordered by what the work actually is, because that is what decides whether a thing gets picked up,
and severity within each group is the chapter's own.

---

## 1. Needs a decision before it needs code

The ones where the obstacle is a question, not effort. Each has an analysis already written.

**Every data-layer row here has closed** — §M23, §M24, §M20, and now §M27, which was filed by this
work while closing §M8 and is the only one of them that was ever genuinely open. Each turned out
smaller than the row said, for the same reason as the rounds before them: the entry was written once
and the code moved under it. **05 §M1 has closed too, and it is the sharpest instance of that
pattern**: the decision it asks for cannot be taken at all, and the thing it was really about turned
out to be one compiler option rather than a metadata model. **05 §M5 has closed as well**, in a
second round that gave a stored value the name of its shape, and a third that made a scope and a
caller's filter meet on one property. **06 §X1 has closed too**, so this group is empty.

| | |
|---|---|
| ~~[01 §M20](./01-data-layer.md)~~ | **closed, and this row was the stale one** — the entry itself ends in a blockquote saying so. `updateAll` is one driver operation with `SELECT … FOR UPDATE` on postgres and the transaction's lease on valkey; callers cannot tell which ran. Phantoms are the one documented limit |
| ~~[01 §M24](./01-data-layer.md)~~ | **closed, and the two stores were never disagreeing on purpose** — valkey already resolved a to-one relation to its foreign key while saving and postgres's one-statement upsert had never learned it. The translation moved into the repository above both, so `belongsToOne` and `manyToOne` are written as their key and the three kinds that keep their key elsewhere are refused by name. TypeORM's own insert builder draws the line in the same place |
| ~~[01 §M23](./01-data-layer.md)~~ | **closed, and it cost no data migration** — `runUp` already wrote the class name on every row, so moving applied-ness onto it needed no backfill. What had to go is `version` being declared `unique`, which is the schema asserting that a release carries one schema change. A second half the entry does not name closed with it: reverts were ordered by version, which stops being a total order the moment two migrations share one |
| ~~[01 §M1, §M2](./01-data-layer.md)~~ | **both closed**, and this row was stale rather than open: `optimisticLocking` on a property makes a conditional write mandatory, and `index` is declared on a property or as a group on the entity. What each one declined is in its own entry |
| ~~[01 §M27](./01-data-layer.md)~~ | **closed, and it needed no decision in the end** — the question this row posed, whether a json column carries a self-describing envelope, turned out to be the wrong question. An object property names a class and an array property names its items, so the metadata was already there and `parseObject` already walked it; nothing on the read path called it. Both stores restore through that walk now and write through one converter that reaches all the way down, so a bigint is written rather than thrown. `@Property.unknown()` is where it stops on purpose: a property that describes nothing leaves nothing to read a date by, and that boundary is documented rather than discovered |
| ~~[05 §M1](./05-di-metadata-and-packaging.md)~~ | **closed, and the decision it poses cannot be taken.** Standard decorators have no parameter decorators and no metadata emit, and the container reads both. What the row conflates is two options: `experimentalDecorators` is what every decorator rides on and every toolchain implements, while `emitDecoratorMetadata` is read in exactly two places — so an application that names its tokens builds under esbuild today. Two supported styles, documented where a reader chooses and tested by compiling one application with four toolchains. That test found the container building a class with **no arguments at all** where the metadata was absent, which had made §D5's error unreachable |
| ~~[06 §X1](./06-tooling-ci-and-testing.md)~~ | **closed, and the grammar is gone.** A differential test against tsc over 62 valid-TSX cases found four constructs *silently mis-parsed* — `class`, `enum`, `do/while` and `function*` were lexed as ordinary identifiers and rebuilt into a different program with no diagnostic — which is the failure this row names, found only because the first version of that test compared accept/reject and had to be told that acceptance is not agreement. TypeScript's parser reads the source now. The decision rested on checking that the client-isolation guarantee lives in the codegen rather than the parser, so the hand-written one was weakening it. The analysis and code generation run on TypeScript's syntax tree and erase types through `ts.transpileModule`, which an equivalence oracle over 490 recorded sources confirmed produced the same output as before; the lowering IR and its nine refusals are deleted, and the analysis walk refuses any syntax it has no case for (`ZTSX006`) instead of skipping it. Client code is analysed by symbol through TypeScript's checker, which closed the same-name leaks the interim `ZTSX007` refusal covered plus two it did not (an unread declaration beside `onClient` in an `if`, an unread declarator in a kept declaration). `import()` and `import.meta` in client code are refused (`ZTSX008`), client code reads from a closed set of names (`ZTSX009`), and the finished client script is re-checked on its own against that set. The server module is the whole template (it used to drop everything but the first component), and emitted code targets ES2022. Props and captured values are written into the page narrowed to the fields client code reads, and whole only where client code uses them whole |
| ~~[05 §M5](./05-di-metadata-and-packaging.md)~~ | **closed, in two rounds with two different rules.** A property holds a value that names its shape, `{ shape: 'Signup', value: … }` declared as `OneOf<{ Signup: Signup, Invite: Invite }>`, and the name travels with the value into storage — which is what let entities take it, encryption, hashing, defaults and exclude follow the shape a value names, and a filter name every shape (`{ contact: { whenSignup: {…}, whenInvite: false } }`) rather than guess. Bodies, parameters and the http client keep the first round's rule, the first shape the value fits, because a caller sends a value rather than an envelope. Found on the way: array items were never restored by `parseObject` or array query/header params; nested validation problems lost their parent path, and an unknown nested key threw instead of being reported; a body's size limit doubled per nested class; the OpenAPI request body ignored `isArray`; on valkey a relation read inside a transaction never saw the transaction's own writes. **The last piece, the scopes, was three defects rather than the one the residue named**: a `whenX` filter on both sides answered no rows, two `isIncludedIn` lists were joined where the conjunction is their intersection (which widens what a scope allows), and every other shared key dropped the branch silently. Every key now says what two of it mean; two patterns, which cannot be one pattern, made `like`/`iLike`/`fuzzyLike` take several values that all hold. **Two bounds on text turned out to be the larger find**: the framework did not know which text sorts after which — the evaluator used the runtime's `localeCompare` and postgres its database's collation — so one filter answered differently on the two stores. Text is ordered by the application's `defaultLocale` now, on the column rather than on the query so ordered reads keep their index, and localization refuses to start when its supported locales disagree and nothing says one order is wanted. **Ordering per request is filed, not built** |
| ~~[06 §X3](./06-tooling-ci-and-testing.md)~~ | **closed, and the tests found three more.** Custom block helpers, `with` and `log` are walked as decided. On the way: no block's `{{else}}` branch was ever walked, so keys read only there were missing from the type; `{{#if (and a b)}}` recorded only `a`; and the framework's own `and` helper rendered its block against the template root, so inside an `each` it printed the wrong item's data |

Two more that arrived while fixing things and are deliberately deferred: a **per-job owner and
heartbeat** for thread jobs, which would make takeover exact instead of timeout-judged
([04 §2.7](./04-infrastructure-subsystems.md)), and the **date model rework** — instant vs
instant-plus-zone vs calendar-date, where `Date` carries no zone.

Two filed by §M12's read-back round and belonging here rather than with the performance group, since
each is a question before it is work: **[01 §M29](./01-data-layer.md)**, whether a bulk write hands
back the rows a read of the same rows would; and
**[01 §M30](./01-data-layer.md)**, the default encryption key created by a read followed by a write.
**§M29 has closed, and the decision it asked for rested on a cost that was not real** — the entry
said resolving relations for a bulk result is a read per row, and it is one read for the whole batch,
which this file's own cost table had written down while the entry reasoned from the opposite. One
statement each for `createAll` and `updateAll({ returnUpdated: true })`, and none for `deleteAll`,
which was already resolving them and which the documentation had described wrongly. The read goes
through the driver rather than through `findAll`, because a soft delete's `deleteAll` is an update
whose rows its own `findAll` is overridden to hide.

**[01 §M33](./01-data-layer.md) is the one the container run turned up**, and it is the read half of
§M31: valkey reads a filter through a unique declaration's index when the filter names everything the
declaration does, and §M31 had just made a partial key index partial rows — so a filter on such a
property answered about the covered rows alone, and a `count` said one where two existed. **An index
narrowed by a predicate stops being usable as a lookup for anything that does not name that
predicate**, which is the same sentence as the "a miss is not an answer" rule already written on that
index, one step further on. Found by the shared cases: postgres and the in-memory store were green,
only valkey was not.
**§M30 has since closed, and it took two other findings with it.** It needed a primitive that did not
exist — **[01 §M31](./01-data-layer.md)**, an `upsert` resolving its conflict against a key covering
part of a table, which postgres infers from the columns and the predicate rather than naming; both
other stores had the same hole outside their sql, looking the conflicting row up by the identity
alone, so which row an identity may land on is shared now rather than written three times. And
restructuring the service to fix the race surfaced **[01 §M32](./01-data-layer.md)**, which is not a
race and is the largest of the three: **one extra strategy row and one extra encryption key on every
single `encrypt` call**, once a table holds strategy rows of which none is the default — a state one
explicitly-named first encryption is enough to reach. Silent, because every value carries the id of
the key that encrypted it, so nothing stops working while two tables grow without bound.

---

## 2. Performance — the whole of it, none of it measured

[04 §3.3–§3.12](./04-infrastructure-subsystems.md) and [01 §M3–§M5, §M8, §M12](./01-data-layer.md)
(§M18 used to be counted here and only half of it belongs — see group 6)
were one body of work: a DB insert per log line, a mail storm from a log storm, three round trips per
cache write, whole-value serialization on every write, `DECIMAL` through strings for every number,
no default limit on `findAll`, no stampede protection, no cache metrics.

**What is left of it is §3.11–§3.12** — the whole caching group and everything above it has closed,
and so have the two data-layer rows.

**§M8 and §M12 closed together, and neither was mainly a performance finding.** §M8's fix is that a
number property says which of four kinds it holds, and the precision bug it names becomes
unreachable rather than caught: each format is stored as something its own type holds exactly. What
that costs is the declared TypeScript type having to match, checked at declaration time where the
type can be read and against the value where it cannot — `number | null` compiles to `Object`.
§M12's other two claims had already closed under it, the third round running where re-reading the
code was what the entry needed most. **Its residue, the read-back after every write, has since closed
as well** — `updateAll({ returnUpdated: true })` is one statement rather than three, so a plain
`updateById` costs two rather than four.

Some of that has since closed — the stampede and the cache metrics (§3.9), the per-call stack trace
(§3.2), `findAll`'s missing limit (01 §M4), and the DB insert per log line with the mail storm beside
it (§3.3, §3.4) — and §3.5 is half closed: the hardcoded `8` and `10` are `sendBatchSize` now, while
the three queries behind them need `EmailPriority` to be sortable before they can become one.

**The three cache rows (§3.6–§3.8) closed too, and two of them were not performance findings.**
§3.6's byte counter was a read followed by an increment, so two instances writing one key left it
permanently too high — a store that then evicts to get under a limit it is not over, and throws away
every later write as fast as it arrives. §3.8's expiry was implemented once per cache kind, and the
flagship one recognized an expired entry and moved on without deleting it. Both are correctness, and
neither needed a number to justify. What §3.6 *did* say about round trips was already half true when
it was written: pipelining had closed one half and the entry had not been revisited. Only §3.7 was
what its heading said, and its fix is exact rather than approximate on purpose — a budget whose
estimate drifts from what it estimates admits more than it says it holds, and drifts most on the
values that make the limit matter.

**§3.3 is the one to read before picking up any of the rest**, because it is the first of these
where the measurement would have been wrong. The fix the finding asks for — batch the writes —
changed almost nothing on its own; what mattered was that entries had nowhere to gather, which the
entry does not mention and a profile of the transport would not have shown either. What is left here
is still unbenchmarked, and the ordering between the items is still a guess.

**These were read off the code, not benchmarked.** No profile, no load test, no numbers anywhere in
the repository — [06 §CI3](./06-tooling-ci-and-testing.md) is exactly that gap. Picking any of them
up should start with a measurement, because the ordering between them is currently a guess.

---

## 3. Distributed correctness

**Nothing.** §1.9, §2.5, §2.10 and §2.12 have all closed since this list was written, and with
[§5.2](./04-infrastructure-subsystems.md)'s email row the *"most of these have no seam"* half of
Tier 1 §1 closed with them. What used to be here is in the executive summary's closed table.

---

## 4. Consumers, packaging and the toolchain

| | |
|---|---|
| [04 §5.2](./04-infrastructure-subsystems.md) | **mostly closed.** What is left is a backup transport other than the local filesystem — an implementation of an interface that already exists, not a seam |
| [04 §4.3](./04-infrastructure-subsystems.md) | **closed.** Egress is an `HttpClientOptions.dispatcher` plus a per-request override; proxy, CA bundle, mTLS, keep-alive and pooling are all how one is built |
| [05 §M2](./05-di-metadata-and-packaging.md) | **closed.** Six of the seven options are on and the code compiles under them. What is left is `exactOptionalPropertyTypes`, which was decided against for now — see the entry |
| ~~[05 §M4](./05-di-metadata-and-packaging.md)~~ | **closed, and the residue was not the hot-reload story the entry ends on.** Registering at module load costs nothing by itself; what cost something is that startup then *built* everything registered, so a service an application never declared was constructed and its `onAppInit` ran. Initialization builds a class only when it declares a lifecycle hook, read off the prototype. The application-level fix changed nothing on its own until five services stopped answering "does anything look like a cache?" by constructing the whole container, and shutdown stopped resolving every registered token to ask it to tear down. The `register: 'onUse'` hole closed with it, at injection rather than at startup, because **what is decidable at startup is what nobody wants and what is decidable at injection is what somebody wants**. What is left is deregistration and a watch-mode restart |
| ~~[06 §X2](./06-tooling-ci-and-testing.md)~~ | **withdrawn, and the re-check this row asked for is what did it.** The finding is a mismatch between two packages and there is nothing left to mismatch: `zibri` publishes one CJS build, using the same bare `default` condition it criticised `zibri-tsx` for. Whether an ESM *consumer* is served well is a different question, and an unfiled one |
| OpenAPI 3.2 | **not filed, and worth doing at some point.** The document is written as 3.1, which has no way to say that a property is an xml element's own text: `@XmlText` is described as if it were a child element, so the published xml schema is wrong for every model using it. 3.2's `xml.nodeType` (`element`, `attribute`, `text`, `cdata`, `none`) says exactly that and replaces `attribute`/`wrapped` with one field. The installed `openapi3-ts` already ships `oas32`, so the switch is the version string, the imports in `open-api.model.ts`, `annotateXml` writing `nodeType`, and checking what the doc UI renders. 3.2 also has `itemSchema` for streamed responses and the `QUERY` method, neither needed today |
| [05 §P5](./05-di-metadata-and-packaging.md) | versions skew across the monorepo. **§P4 closed**, and not by dropping the sources: `declarationMap` and `sourceMap` are on, so following a framework method has to land on what it does rather than on a stripped `.d.ts`. What went was the 37.6MB coverage report and 232 test files that `files` was shipping alongside them |
| ~~[05 §P6](./05-di-metadata-and-packaging.md)~~ | **closed, and the entry had it backwards.** Both paths are right and follow one rule: what is read travels inside the bundle, what is written lives beside it. What was wrong is a copy nothing reads — and a `dist`-only deployment, which the entry took as the shape in question, does not exist, because the bundle leaves `express` and `handlebars` as runtime requires |

---

## 5. CI, release and testability

| | |
|---|---|
| [06 §CD5](./06-tooling-ci-and-testing.md) | no version bump, changelog or tag automation. **§CI1, §CI2 and §CD3 closed** — see their entries |
| [06 §T1](./06-tooling-ci-and-testing.md) | **§T2 and §T3 closed**: the harness is `zibri-testing`, `docs/testing.md` describes it, and `startTestServer` builds on the application's own exported options rather than on parts a test lists. §T1's residue is two `readonly` casts — an asset folder and a data source's port, the last two overrides with no supported way to state them. The private statics are gone, and so is a third case nobody had filed: three test subclasses assigning a private `versionsPath`, closed by two DI tokens and a scratch directory per test server |
| [06 §C4](./06-tooling-ci-and-testing.md) | **assessed, nearly closed.** The generated `src/providers.ts` did not parse and the missing comma was recorded as an accepted sandbox difference; secrets, the database and the seeded admin were hardcoded literals published with the cli; there was no `.gitignore`. All fixed, and the generated code is parsed now. The Dockerfile and the health endpoint [02 §C3](./02-http-runtime-core.md) withdrew from the framework are generated too, checked by an image that is built and run against a database. **What is left is the CI workflow**, which is the same decision as §CD5 and belongs with it |
| [07 Part 1](./07-documentation-vs-code.md) | **closed, and the mechanism that let it rot is closed with it.** Sixteen of twenty-two rows were stale rather than answered — closing another finding changed an option or a type and nobody revisited the page demonstrating it. `src/docs-examples.test.ts` compiles all thirty pages on every run, which found three framework defects on the way through: form data body options that were unreachable through the input type, two exports a DI token names that the barrel never published, and a rename migration whose `down()` could not be typed. Two rows stay open, both tracked elsewhere: [03 §E4](./03-auth-and-security.md) and [05 §M3](./05-di-metadata-and-packaging.md) |
| [07 Part 2](./07-documentation-vs-code.md) | what has no page at all is now three areas rather than six: security hardening (`cors` is an option and nothing documents it; nothing on TLS, `trust proxy`, or headers beyond HSTS), change management (no changelog, no upgrade path, no stability guarantee), and performance (no benchmarks, no complexity notes). Deployment joined replication, connection pooling, di scopes, auth, token lifetimes and testing in having its page, and `docs/tracing.md` arrived with 02 §M7 — the page that used to be "correlation ids" is that one now. Each could only be written once the thing it describes existed, which is the order these two kept getting stuck in. The architecture overview an architect asks for first is still missing |

---

## 6b. The http surface

**Closed.** [02 §M12](./02-http-runtime-core.md) and [§M14](./02-http-runtime-core.md) were the last
two open MAJORs in that chapter. Middleware now names a `MiddlewarePhase` and the pipeline is
assembled once in `start()`, so registration order and lifecycle hooks decide nothing; `405` carries
an `Allow` that the same rule uses to answer `OPTIONS`; and `406` is decided from what a route
declared, before its handler runs.

**[§M7](./02-http-runtime-core.md)'s tracing half has closed too, and closing it deleted the
correlation half.** The trace id *is* the correlation id under a standard name — one value shared by
every service handling one operation, joining log lines and surviving a ticket — and what a
traceparent adds beyond it, a span id and a sampling decision, the correlation id had no answer for.
The objection that a trace context needs a tracer was an artefact of how it was about to be built:
generating one is two random hex strings, so the context is established per request whether or not
anything records spans, and a tracer attaches spans to a context that already exists. **Before adding
a second identifier, check whether the first one is the new one under an older name.** The framework
owns `TracerInterface`, `OpenTelemetryTracer` sets up the SDK and is registered by default, and what
is traced is every request answered, every call made, every driver read and write, every websocket
message, and each cron tick, email pass, backup and restore. The data source is traced at the
**driver** rather than the repository, because a repository operation is not one store operation and
because there is one seam there against fourteen above it. Cache operations and the inside of a
thread job are deliberately out — the first is already fully covered by metrics, the second runs in a
worker that shares no async context.

What stays open in 02 is deliberate: `§C3`'s readiness half (withdrawn) and `§M11`'s two remaining
rows — HTTP/2, and in-process TLS, which the deployment terminates. Per-route timeouts closed with
`handlerInMs` and a `timeoutInMs` a route, a controller or a manually registered route declares;
a handler that overruns is answered 504 and told so through `context.signal`, since nothing can stop
code that is waiting for something. The framework's own waits read that signal themselves — the http
client combines it with its `timeoutMs`, a `'wait'` lease stops queueing, and `waitForThreadJob`
stops polling while the job carries on. A websocket message carries the same deadline and is also
abandoned when its client disconnects, which nothing else would ever notice. In the data layer a
driver decorator refuses the next operation and a statement already running is cancelled on the
server, through a connection the operation owns for exactly that reason — a caller's own transaction
is left alone, since stopping a statement inside one fails all of it.

## 6. Small and known

~~[05 §D8](./05-di-metadata-and-packaging.md)~~ **closed by deleting the cache rather than extending
it** — a `useValue` builds nothing, so caching one saves nothing, and caching it was actively wrong:
registering replaces the provider and never the instance, so a token read once as `undefined` and
re-registered with a real value went on answering `undefined`. Two shipped providers are declared that
way ·
[05 §M3](./05-di-metadata-and-packaging.md) **closed down to the variance limit, and the wider half
was not a type finding at all** — `application.ts` had no `any` left (02 §M12 took it), and the
round that owned `EntityOrder<T>` / `EntityRelations<T>` found the borrowed types promising five
shapes that only postgres answered: `order: { x: 1 }` and an order through a relation were **silently
not sorted** on the two stores that sort in process, `relations: { x: false }` *resolved* the relation
there, and a nested relation read one level. **A public type borrowed from a dependency promises
everything the dependency does, including the parts nothing behind it implements.** Both halves went
the way that keeps the widest behaviour — nested relations and ordering through a to one relation are
taught to every store — and what is gone is only what nothing honoured. The question the entry does
not contain is the one that decided the shape: an order naming a relation has to read it, so `order`
and `relations` stopped being independent. *A relation read because a filter or an order could not be
answered without it is not a relation anybody asked for* — which typeorm had already implemented with
`select: false` joins, so **postgres was right and the finding was the other two stores**, handing
back a relation only a filter had named. What is left is the five in `PropertyMetadata`, still a
**variance limit**: `TKey` sits in both a return and a parameter position of
`EncryptionStrategyInterface`, so it is invariant and `any` is the only supertype of every strategy's
instantiation; making it obsolete means splitting the declared config from the stored one, which is a
change to the encryption model ·
~~[03 §G2](./03-auth-and-security.md)~~ **closed** — half of it had already gone with the ownership
scopes, and the half that had not was carrying a comment claiming it was fixed: four refresh token
states still answered with four distinguishable messages, one of which told a thief the theft worked.
One message for all of them, and a role refusal names no roles. Nothing was lost, because `AuditReason`
already held every distinction and says in its own doc comment why it is a closed set ·
~~[04 §5.3](./04-infrastructure-subsystems.md)~~ **closed** — there is no right interface to pick,
which is why picking one was the bug. Both counters are per interface and labelled, and the host-wide
caveat is documented rather than hidden ·
~~[04 §5.4](./04-infrastructure-subsystems.md)~~ **closed, and the fields it needed were already
declared and written by nothing** — `size` and `completed` existed on the entity, so every row said a
backup of unknown length had never finished, including the ones that had. A checksum and a size are
recorded as the data goes past, written beside the archive as well as into the database because the
database is usually the thing being restored, and a restore refuses before applying anything that does
not match — or that records nothing, since anything that finished recorded what it wrote. A backup
carries the framework version that took it as provenance and a **separate** `formatVersion` as the
compatibility rule: keying readability on the framework's own semver would make every archive
unreadable the next time a major lands for an unrelated reason, which is the one thing a backup must
not do. A defect nobody had filed came out with it: one `Readable` handed to every transport, which a
stream cannot survive. A backup is staged on local disk on its way out and on its way back, which is
what lets every transport have the whole archive without pacing the dump, and a restore read a transport
exactly once. What is left is encryption and an atomic restore, both their own decisions ·
~~[06 §C1–§C3](./06-tooling-ci-and-testing.md)~~ **all three closed, and two of them were hiding
something.** `death(() => {})` registered do-nothing handlers for SIGINT/SIGTERM/SIGQUIT, and Node only
exits on those while nothing is listening — so the cli could not be interrupted at all, and the two line
native replacement the row asks for would have kept that. It exits through the `exitWithInterrupt` the
cli already had, so an interrupt answers the same way during a prompt, during a child process, and
outside both. The cli has coverage and CI uploads it; and the `portability` job, which runs on macOS and
Windows and says in its own comment that container backed suites cannot join it, was running the cli's
heavy suite — which since §C4 builds a docker image. It runs the fast suite now ·
**a versioning defect that had no finding of its own** — an absent `versions` folder was created at
startup and the version being deployed recorded as the first that ever existed, so an image that left
it out served traffic with every route-history guarantee quietly gone. Closed with [06 §C4](./06-tooling-ci-and-testing.md)'s
Dockerfile, which is what made it reachable ·
[01 §M6–§M18](./01-data-layer.md) the remaining data-layer list, **re-checked against the code
rather than carried forward** — the line that used to stand here said "unchanged since the review"
and was wrong about half of it. Closed: **§M6** (the release is in a `finally`, with a test named
for the throwing commit), **§M7** (the default is 20, and `docs/replication.md` says it is counted
per process), **§M16** and **§M17** (both already carried their blockquote and neither heading said
so), **§M9** (a constant `default` becomes the column's default), **§M10**, **§M11** and **§M14**
(`stream` is the way past the bound `findAll` refuses at), **§M5** (the page and the total are one
`findAndCount`, and the skipping it names had a second cause the entry does not: a paginated read
named no order at all, so it was never a page. The half no per-call fix reaches — a walk spanning
requests — is `findAllAfter`, a cursor read built in the round after), **§M19** (closed with §M18's
cast half; the fix the entry suggested turned out to be wrong under the semantics its own test
pinned), **§M8** (a number property says which of four kinds it holds, and the precision loss it
names becomes unreachable rather than caught), **§M20** (`updateAll` is one driver operation on both
stores), **§M12** (the read-back after every write is gone: `UPDATE … WHERE … RETURNING *` is the
single operation the driver interface said no store has, and typeorm's `save` was reading the row a
second time on top — four statements down to two, with the row a write hands back mapped through the
same column metadata a read is mapped through). Also closed: **half of §M18**, the fuzzy one. **Its other half was not a
performance finding at all**: a cast on a json value threw on the data rather than on the query, so
one row of the wrong type took down every filter touching the property. That is closed, and it is
worth reading for the shape: the row asserted a fix (guard the cast, let a bad row not match) that
was declined for making the failure quiet, and the residue — the other store comparing the same rows
loosely instead — is named in the entry rather than left implied. **§M18's fuzzy half has since
closed as well**, and the entry is worth reading for how the declaration went the other way from what
the row assumed: the filter type offers `fuzzyLike` on every string property, so the index is kept
for every one of them and `fuzzySearchable: false` is the opt out — while the four kinds of string a
similarity says nothing about are refused, which is where the type was the thing that was wrong.
Typeorm's `synchronize: false` on an index is the seam that let the ddl be owned outside the orm
without being rebuilt on every boot.

---

## Settled, so nobody re-opens them

- **[06 §CD2](./06-tooling-ci-and-testing.md)** — withdrawn. The missing test gate before publish is
  a branch protection rule on `release`, invisible to a review of the repository.
- **[04 §1.7](./04-infrastructure-subsystems.md)** — withdrawn, mostly.
- **[06 §CI5](./06-tooling-ci-and-testing.md)** — decided against.
- **A 503 during shutdown drain** ([02 §C3](./02-http-runtime-core.md)) — built, then reverted. It is
  unreachable in practice, and a window that 503s correctly-routed traffic is worse than no window.
- **Readiness signalling** — belongs to the project, not the framework: `start()` runs `onAppStart`
  and only then listens, so there is no window where the server accepts while starting up.

## One piece of housekeeping

The evaluation suites carry tests that are red **on purpose** — one per open finding they hold. They
are not a broken build; `di-and-packaging.evaluation.test.ts` alone has eight. Triaging that suite
against this list was deferred to the end of the fixing work, and this is roughly that point.

One item of that triage is done, and it is the shape to look for in the rest. The mail queue's
*"records delivery attempts on the email entity"* asked `Email` for `attempts` and `lastError` — the
two things [§2.2](./04-infrastructure-subsystems.md)'s fix explicitly decided against — so it was red
against a design nobody intends to build, and its own comment still described the deletion that fix
removed. **A red test is only evidence of an open finding while the finding still wants what the test
asserts.** The last two reds were 01 §M9 and 01 §M14's cursor half, and **both are closed** — one of
them by the rule above rather than by the assertion: §M9's test asserted a `databaseDefault`
property option, the fix derives the column default from the constant `default` that already
existed, and a second way to say the same thing is what was declined. Its test reads the live schema
now. §M14's asserted `toHaveProperty('stream')`, which the fix does satisfy, but a method existing
was never the finding — it reads past the bound `findAll` refuses at, stops when the caller stops,
and stays inside the entity's scope. **06 §T2 was the third item of that triage**: its test asserted a `./testing`
subpath on the framework's `exports`, and the finding closed with a separate package instead, for
reasons the subpath could not give. Rewritten to assert what was built — that `zibri-testing` is
published, peer-depends on the framework, and that the framework does not depend on it back.
**05 §M2 was the second item of that
triage, and it went both ways at once**: its `noUncheckedIndexedAccess` test wanted something worth
building and is green because it was built, while its `exactOptionalPropertyTypes` test asserted a
modelling decision nobody had made — so it was removed rather than left red, the same way the mail
queue's was.
