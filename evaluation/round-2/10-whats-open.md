# What's open — round 2

Every finding of this round in one table, by severity, and nothing else. A finding leaves this file
the moment it is completely done; what was decided and how it closed belongs to its chapter, under
its heading. Code quality items (the files under [code-review/](./code-review/), one per chapter plus
the cross-cutting [09](./code-review/09-architecture-and-code-quality.md)) are listed after the findings. The five MINOR rows still open of [08 Part 1](./08-docs-and-dx.md)
(claims the code does not support) are a table in that chapter and are not repeated here.

**0 CRITICAL, 9 MAJOR, 89 MINOR findings; 1 MAJOR and 42 MINOR code quality items** (counted 2026-10-21;
01 §D1, §D2, §D3, §D6, 03 §H1, 05 §I1 and 09 §Q3 closed the same day, and 01 §D14–§D16, which the Q3
file's first postgres run found, were filed and closed the same day too; 03 §H2, §H3, §H4, 01 §D17,
04 §A1, §A2, §A3, §A4, §A5, 05 §I2, §I3, §I4, §I5, 06 §F1, §F2, §F3, §F4, §F5, §F6, §F7, §F8, §F9, §F10, §F14, §F25, 01 §D4, §D5, 02 §S1, §S2, §S4, §S5 and §S6 closed 2026-10-22,
and 06 §F26 split out of §F25 and 01 §D18 out of §D5 the same day; 02 §S7, §S8, §S9, §S10, §S11, 03 §H18, 07 §T1, §T2, §T3, §T4, §T5 and §T6 closed 2026-10-23, and 07 §T21 split out of §T5 and 08 §X26 and 09 §Q14 filed and 08 §X13, §X8, §X9, §X10, §X11, §X12, §X24, §X1, §X2, §X3 and §X4 closed the same day, and 08 §X27 split out of §X3; 08 §X5 closed 2026-10-24, and 01 §D19 and §D20 filed from it the same day, and 08 §X14 and §X15 closed the same day, and 08 §X28 filed from §X15, and 08 §X16 closed 2026-10-25, widening 08 §X28, and 08 §X17 and §X19 closed the same day, and 08 §X20 closed the same day with 07 §T16 and 09 §Q10, and 01 §D21 filed from it, and 02 §S20 filed and closed the same day, and 01 §D21, 08 §X21, §X6, §X7, §X18, §X22 and §X23 closed the same day; 08 §X25, §X26, §X27 and §X28 closed 2026-10-26, and 06 §F27, 04 §A17 and §A18 filed from §X27 and closed the same day, and 03 §H20 filed and closed the same day, and 04 §A10, 01 §D18 and 02 §S3 closed the same day, and 06 §F28 filed and closed the same day, and 01 §D7, §D8, §D9, §D10, §D11, §D12, §D13, §D19 and §D20 closed the same day, and 09 §Q1, §Q6 and 06 §Q4 closed the same day, and 09 §Q9 closed the same day with §Q15 and §Q16 filed from it; 09 §Q5 closed 2026-10-27).

---

## MAJOR

### Data layer

| | |
|---|---|

### Auth and identity

| | |
|---|---|

### Infrastructure

| | |
|---|---|

### DI, packaging, tooling

| | |
|---|---|

### Docs and DX

| | |
|---|---|

### Architecture (MAJOR)

| | |
|---|---|
| [09 §Q2](./code-review/09-architecture-and-code-quality.md) | typeorm carries a double model and is bypassed for every store-specific guarantee |

## MINOR

### Data layer

| | |
|---|---|
| [02 §S12](./02-data-layer-stores.md) | the valkey schema lock is shared by every application on the server |
| [02 §S13](./02-data-layer-stores.md) | a migration's transaction idles out after ten seconds, and a migration cannot say otherwise |
| [02 §S14](./02-data-layer-stores.md) | migrations: no checksum, no generator, no operator entry point |
| [02 §S15](./02-data-layer-stores.md) | a backup's name is an unvalidated path segment on every transport |
| [02 §S16](./02-data-layer-stores.md) | a failed backup stays on the transports and in the table; no retention, no schedule |
| [02 §S17](./02-data-layer-stores.md) | `RestoreNotUndoneError` cannot be made impossible; what can be is narrower |
| [02 §S18](./02-data-layer-stores.md) | the staging folder is a third written path that `deployment.md` does not list |
| [02 §S19](./02-data-layer-stores.md) | starting a postgres transaction costs three to four statements before any work |

### HTTP runtime

| | |
|---|---|
| [03 §H5](./03-http-runtime-core.md) | an optional body cannot be left out |
| [03 §H6](./03-http-runtime-core.md) | a file is always an attachment, and a non-ASCII filename reaches the user percent-encoded |
| [03 §H7](./03-http-runtime-core.md) | error bodies carry developer prose |
| [03 §H8](./03-http-runtime-core.md) | the document does not say that an optional property accepts `null` |
| [03 §H9](./03-http-runtime-core.md) | an undecorated handler parameter is a 500 on the first call rather than a refusal at boot |
| [03 §H10](./03-http-runtime-core.md) | preflights are never cached |
| [03 §H11](./03-http-runtime-core.md) | no cache directive on authenticated responses, and a served file says `public` |
| [03 §H12](./03-http-runtime-core.md) | a status cannot be chosen at run time; the streaming the docs mention is undocumented |
| [03 §H13](./03-http-runtime-core.md) | a plugin cannot ship websocket controllers, two-factor methods, data sources or backup transports |
| [03 §H14](./03-http-runtime-core.md) | the route record is written where the application runs |
| [03 §H15](./03-http-runtime-core.md) | the html error fallback logs three warnings per request |
| [03 §H16](./03-http-runtime-core.md) | the explorer and the document are public by default, permission names included |
| [03 §H17](./03-http-runtime-core.md) | the keep-alive default produces intermittent 502s behind every common proxy |
| [03 §H19](./03-http-runtime-core.md) | header names are matched case-sensitively, and the docs example hits it |

### Auth and identity

| | |
|---|---|
| [04 §A6](./04-auth-core.md) | `ACCESS_TOKEN_REVOCATION` and `REVALIDATE_USER_ON_AUTH_CHECK` are silent defaults for a security choice |
| [04 §A7](./04-auth-core.md) | `POST /request-password-reset` is a timing oracle for account existence |
| [04 §A8](./04-auth-core.md) | enrolling or removing a second factor is not audited; neither is deactivating a membership |
| [04 §A9](./04-auth-core.md) | the cookie strategy's documented in-request renewal cannot happen in a browser |
| [04 §A11](./04-auth-core.md) | the account lifecycle routines an enterprise expects are left to the application |
| [04 §A12](./04-auth-core.md) | roles have no inheritance or wildcard; role assignment is a read-modify-write |
| [04 §A13](./04-auth-core.md) | access tokens carry the user's email and role names |
| [04 §A14](./04-auth-core.md) | `REVALIDATE_USER_ON_AUTH_CHECK: false` saves no read in a tenant |
| [04 §A15](./04-auth-core.md) | hardcoded constants in the reworked auth code: which deserve a token |
| [04 §A16](./04-auth-core.md) | recheck of what auth refusals tell the caller (mostly clean) |
| [05 §I6](./05-identity-providers.md) | a provider token-endpoint outage is reported as a forged answer |
| [05 §I7](./05-identity-providers.md) | one issuer per authenticator: a multi-tenant Entra registration cannot sign anyone in |
| [05 §I8](./05-identity-providers.md) | provider metadata is read lazily, cached for the process, never checked at boot |
| [05 §I9](./05-identity-providers.md) | the protocol constants an enterprise would tune are hardcoded |
| [05 §I10](./05-identity-providers.md) | LDAP opens a fresh TLS connection and bind per sign-in, refresh and renewal |
| [05 §I11](./05-identity-providers.md) | `Bearer` and the api key header are matched case-sensitively |

### Infrastructure

| | |
|---|---|
| [06 §F11](./06-infrastructure.md) | `EventCleanupCronJob` swallows every error |
| [06 §F12](./06-infrastructure.md) | `Lease.heldBy` is the application name, which every replica shares |
| [06 §F13](./06-infrastructure.md) | lease expiry is judged by each instance's own clock |
| [06 §F15](./06-infrastructure.md) | event payloads carry no schema version; the ordering guarantee is undocumented |
| [06 §F16](./06-infrastructure.md) | the worker pool is sized from `os.availableParallelism()`, ignoring the cpu quota |
| [06 §F17](./06-infrastructure.md) | a mail batch larger than `maxEmailsPerHour` is never sent |
| [06 §F18](./06-infrastructure.md) | a payment the buyer never approves stays `CREATED` forever |
| [06 §F19](./06-infrastructure.md) | a backup or restore is guarded per process only |
| [06 §F20](./06-infrastructure.md) | the http client follows redirects unconditionally and has no `HEAD`/`OPTIONS` |
| [06 §F21](./06-infrastructure.md) | console logging is human-formatted only; levels are per transport rather than per origin |
| [06 §F22](./06-infrastructure.md) | `prom-client` is deprecated upstream |
| [06 §F23](./06-infrastructure.md) | an invoice's year is the server's local calendar year |
| [06 §F24](./06-infrastructure.md) | one worker thread runs many jobs and tenants; only module scope is reset between them |
| [06 §F26](./06-infrastructure.md) | nothing tells an edited or deleted audit entry apart from a recorded one |

### DI, packaging, tooling

| | |
|---|---|
| [07 §T7](./07-di-packaging-tooling.md) | `DuplicateFrameworkCopyError` fires in a consumer's test after `jest.resetModules()` |
| [07 §T8](./07-di-packaging-tooling.md) | translation extraction re-parses and prints the whole framework source on every build |
| [07 §T9](./07-di-packaging-tooling.md) | the scaffold installs `ts-node` for worker files that cannot exist in a bundled app |
| [07 §T10](./07-di-packaging-tooling.md) | a `?client` package whose browser entry is an ES module fails in the browser rather than at build |
| [07 §T11](./07-di-packaging-tooling.md) | compiled templates carry no source map through the webpack loader or the jest transform |
| [07 §T12](./07-di-packaging-tooling.md) | actions pinned by major tag, an unpinned `npm@latest`, CI not run on pull requests |
| [07 §T13](./07-di-packaging-tooling.md) | `prom-client` is deprecated (packaging side) |
| [07 §T14](./07-di-packaging-tooling.md) | nothing measures the size or start time of a built production application |
| [07 §T15](./07-di-packaging-tooling.md) | a PDF attachment's `src` is a file path read by pdfkit, without the `FsPath` brand |
| [07 §T21](./07-di-packaging-tooling.md) | the metrics explorer is framework UI copied into the project |

### Docs and DX

| | |
|---|---|

## Code quality items (all MINOR unless marked)

| | |
|---|---|
| [01 §Q1-Q7](./code-review/01-data-layer-repository.md) | `repository.ts` holds four concerns; service locator in the write path; class helper semantics; naming; stale comments; two soft-delete paths |
| [02 §Q1-Q6](./code-review/02-data-layer-stores.md) | `PostgresDataSource` is five concerns; two trigram implementations; error classification by prose; placeholder renumbering by regex; private backup errors; valkey lock namespace |
| [03 §Q1-Q9](./code-review/03-http-runtime-core.md) | three shutdown runners; version-overlap refusal built four times; browser JS as string arrays; the four largest files; file suffixes; two deadline mechanisms; manual routes reimplement the controller path; error classification three times; five identical parser arms |
| [04 §Q1-Q5](./code-review/04-auth-core.md) | `AuthService` at 2,041 lines with four decorator-resolution copies; `get` verbs doing round trips; error swallowing; module-level functions; per-tenant indexes through `runAs` |
| [05 §Q1-Q6](./code-review/05-identity-providers.md) | `ScimService` and `BaseFederatedAuthenticator` sizes; orphaned JSDoc; four cleanup jobs of one shape; `startConnection`/`linkIdentity` naming; duplicated lookups with `inject` per request; collapsed error reasons |
| [06 §Q1-Q3, Q5, Q6, Q9](./code-review/06-infrastructure.md) | three files carry their subsystem; dead `adoptDeclaredPolicy`; wrong-cost verbs; wrong JSDoc; `any` payment interface; seventeen sweepers |
| [07 §T17-T20](./code-review/07-di-packaging-tooling.md) | `??` dedupe by `useValue`; `register` side channel; the scaffold as string arrays; the sandbox is not a reference app |
| [09 §Q4, Q7, Q8, Q11-Q16](./code-review/09-architecture-and-code-quality.md) | two data sources duplicate construction; auth constants vs tokens; seventeen cleanup jobs; time units spelled two ways; positional vs option transactions; inconsistent `Base` prefix; reasoning in published JSDoc; `MetadataUtilities` holds every subsystem's accessors; `HttpStatus` cycle |
