# 11 — Review of the code no round had read

*Filed and worked through 2026-10-29.* After this round's findings were all closed, the user asked for
the next open work and chose to review what neither round had read (round 1's 09 "Not reviewed at all",
and every chapter's *Not reviewed* list here). Seven read-only passes covered: the class helpers and DI
promotion; localization, `src/document` and `src/assets`; the valkey and in-memory stores; the auth code
no pass had read; caches, the S3 signature, cron and the cleanup jobs; the `zibri-tsx` compiler; and
`src/utilities`, `src/handlebars` and the cli. Every finding was re-read against the code before it was
fixed, and every fix has a test that failed first unless the row says otherwise.

IDs are this chapter's own: `11 §T1` is not `07 §T1`. The V and W rows come from a second pass on
2026-10-30 over what was still left of that list.

Found sound, so not filed: the S3 SigV4 signing, the write-behind caches, cross-instance cache
invalidation, the websocket and rate-limit cleanup jobs, passkeys (challenge binding, counter, MDS),
JWT and DPoP checks, client certificates and client access tokens, SCIM tenant scope, auth error
messages (no new leak since 04 §A16), the XML escaping and entity handling, PDF generation, static asset
serving, DI lazy promotion, the class helpers' model metadata, and the tsx escaping runtime.

## zibri-tsx

| ID | Finding | Severity | Status |
|---|---|---|---|
| T1 | A prop computed with a callback (`users.filter(u => u.active)`) was taken for a client function: the child got a marker, and the whole unfiltered value reached the page | MAJOR | Fixed: a function handed to a call is the call's input (`client-props.ts`). `client-props.test.ts`, `server-code-isolation.test.ts` |
| T2 | Email components wrote props into attributes unescaped; `MjButton`/`MjImage` let `javascript:` through | MAJOR | Fixed: `withDefaults` escapes every value, `MjBody` and `Mjml` their own, `isScriptUrl` drops the url. `email-components.test.ts` |
| T3 | Props for client code were looked up by binding name: `(props)`, `{ label: text }` and `{ item: { label } }` got `{}`, the last one throwing and stopping every later setup | MAJOR | Fixed: picked by the props' own keys, `'all'` when used whole. `render-page.test.ts` |
| T4 | A handler reading a `const` declared in a callback body or an `if` block got nothing, or a browser global of the same name | MAJOR | Fixed: a nested block is a captured scope. `client-codegen.test.ts` |
| T4a | Found on the way: an early JSX `return` skipped attaching the handlers of the markup it rendered, and a guard holding only a JSX return was pruned so code after it ran on the client | MAJOR | Fixed: `__zibriAttach` runs before every JSX return's break; a statement returning markup early is kept when code after it is. `client-codegen.test.ts` |
| T5 | A dynamic element's tag name was written unvalidated | MINOR | Fixed: refused unless it is a tag name. `dynamic-element.test.ts` |
| T6 | Entities in JSX text and string attributes were escaped twice | MINOR | Fixed: decoded with TypeScript's JSX entity table first. `render-codegen.test.ts` |
| T7 | `MjTitle`/`MjPreview` of text and values escaped twice, `MjStyle` css HTML-escaped | MINOR | Fixed: head text flattens arrays raw. `email-components.test.ts` |

## Class helpers and routes

| ID | Finding | Severity | Status |
|---|---|---|---|
| C1 | A route decorator on a subclass pushed onto its parent's route array: siblings and the parent served each other's routes | MAJOR | Fixed: `addControllerRoute`/`addWebsocketControllerRoute` copy, and a redeclared method replaces its inherited route. `metadata.utilities.test.ts` |
| C2 | `OmitClass`/`PickClass`/`IntersectionClass` dropped a controller's class-level `@Auth` checks | MAJOR | Fixed: carried onto each copied route that declares none of its own. `class-property.utilities.test.ts` (401 over http) |
| C3 | `IntersectionClass` kept the first base's per-method metadata (`@Auth.skip` included) for a method the last base declares | MAJOR | Fixed: the target's own metadata of a copied member is cleared first. `class-property.utilities.test.ts` |
| C4 | `PartialClass` let an explicit `null` through for a property the base requires | MINOR | Fixed (user: refuse null): `required` is a function required when the key is given; OpenAPI says no null for it. `class-property.utilities.test.ts`, `open-api.service.test.ts`, models.md |
| C5 | The copying helpers dropped the `@Xml*` declarations of the properties they keep | MINOR | Fixed. `class-property.utilities.test.ts` |

## Localization, XML, assets

| ID | Finding | Severity | Status |
|---|---|---|---|
| L1 | `?locale=de&locale=en` crashed every `$ts` with a 500, the error handler included | MAJOR | Fixed: the request's query type is `string \| string[]`; a locale named twice falls to the header, a version named twice is a 400. `translation-round-trip.test.ts`, `versioning.service.test.ts` (postgres) |
| L2 | An empty `<target/>` served an empty string | MAJOR | Fixed: skipped like a missing target. `parse-translation-xlf.function.test.ts` |
| L3 | `formatPrice`/`formatDate`/`formatPercent` wrote the resolved locale into the caller's options | MAJOR | Fixed. `localize.service.test.ts` |
| L4 | Accept-Language: `q=0` chosen, whitespace before `;q=` dropped the weight, an empty or unsupported `?locale=` shadowed the header | MINOR | Fixed. `localize.service.test.ts`, `translation-round-trip.test.ts` |
| L5 | localization.md's example outputs did not match the code (`85.6%`, `15:45 Uhr`, `3:45 AM`) | MINOR | Fixed in the docs |
| L6 | `name in params` substituted `{constructor}`; literal braces typed by a translator are read as placeholders | MINOR | Fixed (user: only the source's names): with `Object.hasOwn`, `{name}` in a target is a placeholder only where the source has one of that name, other braces are text, `{{`/`}}` one brace; escaping all of the translator's text would have broken the documented `{lastName}` targets. What was missing is a warning at boot for a target leaving out a placeholder of its source, now there. `translate.function.test.ts`, `translation-round-trip.test.ts`, localization.md |
| L7 | A single-key object value is a named placeholder at runtime and a numbered one at extraction | MINOR | Documented (user: docs only): extraction reads no types, so it cannot tell a variable holding a one-key object from one holding a text. localization.md says to write the object inline; the stale "Transform ran" comment corrected |
| L8 | `indent: true` wrote whitespace into mixed content of elements alone | MINOR | Fixed: `XmlElementNode.mixed`. `xml.utilities.test.ts` |
| L9 | The asset tree was a plain object (`constructor`, `__proto__`) and its routes were not url-encoded | MINOR | Fixed: a `Map`, each segment encoded. `asset-service.test.ts` |
| L10 | Two attributes of one local name: the last won | MINOR | Fixed: the unprefixed one wins. `xml.utilities.test.ts`, xml.md |

## Stores

| ID | Finding | Severity | Status |
|---|---|---|---|
| S1 | `findAllAfter` through a relation returned empty pages after the first, in memory and on valkey | MAJOR | Fixed: the window is filtered before the filter's relations are taken off. `paged-reads.cases.ts` (valkey half in `paged-reads.postgres-valkey`) |
| S2 | The evaluator cached `oneOf` sets by array identity, so a list changed in place answered stale, the write-scope check included | MAJOR | Fixed: forgotten once the rows checked together are checked. `where-filter.evaluator.test.ts` |
| S3 | Ordering by a `bignumber` sorted as text in memory and on valkey | MAJOR | Fixed (`NumberUtilities.isBigNumber`). `number-formats.cases.ts` |
| S4 | `upsert`/`upsertAll` wrote no change set, and changed a soft-deleted row | MAJOR | Fixed (user: refuse like create): change sets CREATE/UPDATE by the before state; an identity a covering unique keeps for a deleted row is refused. `soft-delete-repository.test.ts`, data-source.md |
| S5 | Postgres answers JSON filters (`is`/`not` as containment, partial `includes`, set-equal arrays, `not: [..]`) differently from the evaluator; nested bigint/BigNumber/object `oneOf` refused there and answered in memory | MAJOR | Fixed in the converter: an object or a list is compared as a whole json document, a list given as the value in order, `includes`/`isIncludedIn` of objects item by item, a large number inside json by its digits. `nested-where-filter.test.ts` had recorded the partial `includes`, corrected, and `where-filter.test.ts` the refused object `oneOf`, now a function in the list. The in-memory store could not write a bigint inside an object, fixed on the way. `where-conformance.cases.ts` (postgres red, user's run) |
| S6 | On valkey, a built index on a bignumber misses `price: 10` written as a plain number | MAJOR | Fixed: a number or bigint naming an exact decimal is encoded as the decimal, and a BigNumber in a filter takes the index too. `number-formats.cases.ts` (`price` indexed; valkey in `.postgres-valkey`, user's run) |
| S7 | Restoring a soft-deleted row recorded no change set | MINOR | Fixed: a forced `RESTORE`. `soft-delete-repository.test.ts`, data-source.md |
| S8 | In-memory text ordering used `localeCompare` instead of `compareText` | MINOR | Fixed. `text-order.cases.ts` with `sv-SE` as the default locale (in memory; postgres and valkey in `.postgres-valkey`), red against `localeCompare` |
| S9 | `like`/`fuzzyLike`/a text bound on a uuid answered in memory, refused by postgres | MINOR | Fixed: refused on every store. `where-conformance.cases.ts` |
| S10 | Text comparisons inside JSON on postgres ignore the collation | MINOR | Fixed: a text read out of json is compared by the collation the text columns have. `text-order.cases.ts` with `sv-SE` (postgres red, user's run), `postgres-where-filter.converter.test.ts` |
| S11 | An upsert increment on null: null on postgres, the amount elsewhere | MINOR | Fixed: null counts as 0 everywhere, as an update's increment. `upsert-conflict-values.cases.ts` (postgres red), data-source.md |
| S12 | Two in-memory transactions changing different columns of one row lose one | MINOR | Fixed: a committing transaction does what it changed again to the row as it is then, the columns it wrote and the amounts it added; a row deleted meanwhile stays deleted. The same whole-row write had also lost a concurrent increment and brought a deleted row back. `concurrent-row-updates.cases.ts` (in memory; postgres and valkey in `.postgres-valkey`) |
| S13 | `like`'s `_` did not match a character outside the basic plane in memory | MINOR | Fixed. `where-filter.evaluator.test.ts` |
| S14 | On valkey, a delete or a direct save outside a transaction did not wait for a transaction holding the row, against "holds every row it writes" in data-source.md: a row deleted meanwhile came back at the commit, holding only the columns the transaction changed | MAJOR | Found by S12's valkey case in the user's run. Fixed: the guarded write outside a transaction also requires that no transaction holds a key it overwrites, and a write refused for that runs again in a transaction of its own, which queues on the grant as an update outside one already did. `concurrent-row-updates.cases.ts` (valkey in `.postgres-valkey`, user's run) |

## Caches and cron

| ID | Finding | Severity | Status |
|---|---|---|---|
| K1 | Every `ValKeyCacheStore` on one data source shared a keyspace: caches read, evicted and cleared each other's entries | CRITICAL | Fixed: `attachTo(cacheName)`, a store refused for a second cache. `val-key-data-source.test.ts` (valkey), caching.md, upgrading-to-3.md |
| K2 | Valkey `invalidateTags` was not atomic: an entry written meanwhile lost its tag for good | MAJOR | Fixed: one script. `val-key-data-source.test.ts` (valkey) |
| K3 | A fill that started before a write cached what the write replaced, on the writing instance | MAJOR | Fixed: `FillGuardedCacheStore` wraps every cache's store; read-through and multi-tier fills skip a stale value. `read-through.fill-race.test.ts` |
| K4 | node-cron skips the repeated hour of a fall-back night: every sub-hourly job in a DST zone, the framework's pollers included, stopped for an hour | MAJOR | Fixed: a schedule naming no hour, day or month is read in UTC where that names the same moments. `cron-expression.utilities.test.ts` |
| K5 | A 02:30 job is skipped on the spring-forward day | MINOR | Documented in cron.md as the clock's behavior |
| K6 | `InMemoryCacheStore.set` on an existing key ignored `maxBytes` | MINOR | Fixed. `in-memory.cache-store.test.ts` |
| K7 | A full valkey store with MRU or LFU evicted the entry it just wrote | MINOR | Fixed. `val-key-data-source.test.ts` (valkey) |
| K8 | Valkey tag sets were never pruned | MINOR | Fixed: a hash of each entry's tags. `val-key-data-source.test.ts` (valkey) |
| K9 | A valkey miss could drop a value written in between | MINOR | Fixed: a drop after a miss leaves a value that is back. `val-key-data-source.test.ts` (valkey) |
| K10 | `every(n, 'days'\|'hours')` resets at the month or day | MINOR | Documented in cron.md |

## Auth

| ID | Finding | Severity | Status |
|---|---|---|---|
| A1 | A login with a hash cheaper than the stand-in (an old cost, legacy scrypt, 2.x bcrypt) answered sooner than an unknown address | MAJOR | Fixed (user: pad to the stand-in): every comparison takes at least the measured stand-in duration. `password.authenticator.timing.test.ts`. A hash costlier than today's still shows |
| A2 | `encrypt` with a `keyId` and no strategy stamped the named key and encrypted with the default one | MAJOR | Fixed. `encryption.service.test.ts` (postgres) |
| A3 | AES-GCM accepted a truncated authentication tag | MINOR | Fixed: 16 bytes or refused. `aes-gcm.encryption-strategy.test.ts` |
| A4 | A deeply nested SCIM filter answered 500 | MINOR | Fixed: 64 levels, then an invalid filter. `scim-filter.utilities.test.ts` |

## Utilities, handlebars, cli

| ID | Finding | Severity | Status |
|---|---|---|---|
| U1 | `zi upgrade` cannot merge a file it merged once: the base it records is in no commit | MAJOR | Fixed (user: regenerate the recorded release): a base in no commit is generated again from the manifest's answers, in process for this release and with `npx zibri-cli@<release> generate` for another; used only when it hashes as recorded. The new `zi generate` writes a project's files and installs nothing. `upgrade.command.test.ts`, `generate.command.test.ts`, getting-started.md |
| U2 | Handlebars inference typed bare keys inside `each`/`with` at the root | MAJOR | Fixed: one resolver of handlebars' context rules; the `example.hbs` expectation that recorded it corrected. `block-helpers.test.ts`. Fix written before its tests |
| U3 | `@index`, `../x`, `@root.x` and hyphenated keys produced invalid TypeScript | MAJOR | Fixed: data variables are no keys, names quoted. `block-helpers.test.ts`, `generate-handlebar-type.test.ts` |
| U4 | A root `{{this.title}}` was typed under `undefined` | MINOR | Fixed with U2 |
| U5 | `copyDeep` made an own `__proto__` key the copy's prototype, reachable through a oneOf body | MINOR | Fixed. `one-of-bodies-and-params.test.ts` |
| U6 | `updateFile` append/prepend lost content after an empty first line (zibri and cli) | MINOR | Fixed. `fs.utilities.test.ts` |
| U7 | `zi migrate create` rewrote tabs and the trailing line break of the project's migrations index | MINOR | Fixed. `migrate.command.test.ts` |
| U8 | A `chunkSize` of 0 looped forever, NaN ran nothing | MINOR | Fixed: refused. `promise.utilities.test.ts` |
| U9 | `zi upgrade` ignored pre-release order | MINOR | Fixed: SemVer precedence. `is-later-version.function.test.ts` |
| U10 | The project path was unquoted in `cd ... && npm i` | MINOR | Fixed. `new`, `upgrade`, `remove` tests |

## Validation and the build

*Read 2026-10-30*, the last of round 1's 09 "Still unreviewed": `src/validation`, the webpack
configuration and its plugins, the zibri-tsx loader, vendor bundles and template source maps. The
loader, the vendor bundles and the source maps were found sound.

| ID | Finding | Severity | Status |
|---|---|---|---|
| V1 | `min`, `max` and `enum` of an exact decimal compared it as a double: `BigNumber('10.0000000000000000001')` passed `max: 10` | MINOR | Fixed: compared by value. `validation.service.test.ts` |
| V2 | `minLength`/`maxLength` counted UTF-16 units, the OpenAPI schema states characters: three emoji were six | MINOR | Fixed: counted in characters. `validation.service.test.ts` |
| V3 | A websocket message `null` reached `Object.keys` and was answered and logged as a server error; a number or a list passed as a request | MINOR | Fixed: refused as no object. `websocket-payload.test.ts` |
| V4 | An array passed for an object property, and validation took a Date, BigNumber or File as an object where choosing a shape did not | MINOR | Fixed: one rule for both. `validation.service.test.ts` |
| V5 | Choosing a shape counted a key named like an inherited member (`toString`) as declared, so validation then refused the shape it chose | MINOR | Fixed: `Object.hasOwn`. `one-of-validation.test.ts` |
| W1 | `webpack --watch` started the rebuilt application the moment it told the old one to stop, through a shell its kill may not pass on: the new one could find the port still held | MINOR | Fixed: no shell, started once the old one exited, killed after 10 s. Tests rewritten on real processes |
| W2 | The restart ran `dist/bundle.js` from wherever webpack was started, not the application root | MINOR | Fixed: run from the root `resolveWebpackConfiguration` is given. Same tests |

## Round-2 assessments never acted on

| ID | Finding | Status |
|---|---|---|
| 06 §Q7 | The mail rate limiter counts per instance | Decided (user): email.md warns and shows replacing it with a shared one |
| 06 §Q8 | Thread jobs whose effect is a write could run exactly once | **Open** (user: solve at `queueThreadJob`; design to be proposed) |
