# Executive Summary — The Rejection List

Ordered by whether the item can be patched or requires redesign. Each entry links to the
detailed finding.

---

## Status

Findings are being worked through, and each closed one is now held shut by a test that failed
before the fix and passes after it. Run them with `npm run test:cluster -w zibri` and
`npm run test:evaluation -w zibri`.

**Closed:**

| Finding | Held by |
|---|---|
| [04 §1.1](./04-infrastructure-subsystems.md) cron ran on every replica | `cluster/cron.cluster.test.ts` |
| [04 §1.4–1.5](./04-infrastructure-subsystems.md) events did not cross processes; replay duplicated | `cluster/events.cluster.test.ts` |
| [01 §C2](./01-data-layer.md) migrations and `synchronize` raced across replicas | `cluster/migrations.cluster.test.ts` |
| [01 §M20](./01-data-layer.md) `updateAll` returned the wrong rows, and was a read followed by a write that two callers could both win | `data-layer.evaluation.test.ts` |
| [04 §1.11](./04-infrastructure-subsystems.md) invoice numbering raced, even in one process | `invoicing.evaluation.test.ts` |
| [04 §1.8](./04-infrastructure-subsystems.md) tag invalidation skipped multi-tier caches | `caching.evaluation.test.ts` |
| [04 §1.9](./04-infrastructure-subsystems.md) a local cache tier stayed stale on other replicas | `cluster/caching.cluster.test.ts` |
| [04 §1.10](./04-infrastructure-subsystems.md) websocket broadcasts reached one instance's clients | `cluster/websocket.cluster.test.ts` |
| [04 §1.6](./04-infrastructure-subsystems.md) every replica drained the mail queue | `cluster/mail.cluster.test.ts` |
| [10 §10.1](./10-leases-and-claims.md) `withLock` lost exclusion and then freed the next holder's lock | `cluster/lock.cluster.test.ts` |
| [10 §10.2](./10-leases-and-claims.md) a slow subscriber ran repeatedly, and killed the replica that lost the claim | `cluster/events.cluster.test.ts` |
| [10 §10.3](./10-leases-and-claims.md) a mail outliving the cron tick was sent again by the next slot | `cluster/mail.cluster.test.ts` |
| [10 §10.2a](./10-leases-and-claims.md) `updateById` upserted a deleted row back into existence | `data-layer.evaluation.test.ts` |
| [02](./02-http-runtime-core.md) a background rejection ended the process; no `unhandledRejection` handler | `cluster/events.cluster.test.ts` asserts every replica still serves after losing a claim |
| [02 §C3](./02-http-runtime-core.md) one stuck request blocked the entire shutdown, leases included | `cluster/shutdown.cluster.test.ts` *(the readiness half was withdrawn as the wrong layer, not fixed)* |
| [02 §C6](./02-http-runtime-core.md) the upload cleanup cron deleted live uploads and kept expired ones — and in fact deleted nothing at all, while the default upload directory sat inside the installed package | `http-and-observability.evaluation.test.ts` |
| [01 §C5](./01-data-layer.md) a filter value could rewrite the statement it was filtered with | `sql-building.evaluation.test.ts` |
| [01 §M6](./01-data-layer.md) a transaction that reached neither a commit nor a rollback held its pooled connection, and its valkey grants, for the life of the process — enough of them and no query anywhere is served again, and no replica can write those rows until this one restarts | `abandoned-transaction.test.ts`, `abandoned-val-key-transaction.test.ts`, `transaction.test.ts` *(the `runInTransaction` helper is declined: it cannot see a transaction it is already inside)* |
| [01 §M7](./01-data-layer.md) a pool of 100 per process asked a stock database for twenty times what it accepts, so the first scale-out took it down for every replica at once | `data-layer.evaluation.test.ts` |
| [01 §M4](./01-data-layer.md) one `findAll()` streamed a whole table into the heap — refused now rather than trimmed, because a caller looping over a trimmed result does half its work silently | `data-layer.evaluation.test.ts` |
| [01 §M5](./01-data-layer.md) a paginated read reached the store with no `ORDER BY` at all — `defaultOrder` is optional and almost nothing declares one — so which rows a page held depended on where each row happened to sit, and a table being written to handed the same row back on two pages while passing over one that was never read. **No concurrent writer was needed for it.** The page and its total were separate statements on top of that; they are one `findAndCount` now, and the postgres driver takes the snapshot it needs itself. What no per-call fix reaches — a walk spanning requests, where every page number shifts under an insert — is `findAllAfter`, a cursor read that hands back every row present when the walk started exactly once | `data-layer.evaluation.test.ts`, `in-memory-data-source.test.ts`, `repository.test.ts` |
| [01 §M2](./01-data-layer.md) no index could be declared at all, so every lookup the framework did not build itself read the table — and a column declaring itself `unique` could not identify a row for an `upsert` | `declared-indexes.test.ts`, `data-layer.evaluation.test.ts` *(partial and covering indexes stay open)* |
| [01 §M19, §M18](./01-data-layer.md) a filter reaching into an object column answered two ways about the same rows. Asking for `null` found a property written as null but never one that was never written — while `not: null` found both, so a row holding null answered yes to both questions at once. And a value whose type the entity no longer declares made the *whole query* throw with the value and nothing else, reading like the query is broken rather than like one row is. The null halves are one condition now and exact complements; the throw is kept deliberately — a row that cannot be compared is not a row that failed the comparison — and names the property, the declared type and what it found. **Pinning the semantics first is what caught the fix the finding itself suggested being wrong**, and a second defect with it: once absent counts as null, a row with no object at all starts answering questions about the properties inside it | `postgres-jsonb-value-types.test.ts`, `mistyped-values.cases.ts` *(the same rows compared loosely on the other stores, named in §M18, closed since: every store refuses them alike)* |
| [06 §C4, 05 §P6, 02 §C3](./06-tooling-ci-and-testing.md) a generated project had no way to be deployed and no way to say whether it was healthy. It has a Dockerfile, a `.dockerignore` and the health controller §C3 withdrew from the framework on the grounds that a project would write one — nobody had. **Writing the Dockerfile is what exposed the defect underneath it**: the application created its `versions` folder when it found none and recorded the version being deployed as the first that ever existed, so an image that left the folder out came up healthy with every route-history guarantee silently gone. An absent folder is a refusal to start now, and only an empty one is permission to record a first snapshot. §P6's asymmetry turned out to be correct and its premise wrong — a `dist`-only deployment does not exist, since the bundle leaves `express` and `handlebars` as runtime requires — so what closed there is a copy nothing reads | `new.command.docker.heavy.test.ts` *(the image is built and run against a database and asked what only a running one can answer)*, `versioning.service.test.ts`, `new.command.sandbox-parity.test.ts` *(the CI workflow closed with §CD5: `zi new` asks, and the heavy suite runs the generated workflow on a checkout without `.env`)* |
| [01 §M26](./01-data-layer.md) two entities referencing each other are a cycle, and whichever of them was resolved first decided — permanently — whether the other's nested defaults, encryption, hashing and exclusion were registered at all. No declaration changed the outcome, nothing warned, and a nested `encryption: true` value could be written in plaintext | `model-registry.test.ts` |
| [01 §M3](./01-data-layer.md) a bulk update issued one statement per row it matched — 306 for 300 rows — and handed back every one of them, so `UPDATE t SET x = 1 WHERE tenant = $1` over a large tenant was the pod's memory as well as its round trips. Two statements now, and a count unless the entities are asked for | `data-layer.evaluation.test.ts` |
| [01 §M3](./01-data-layer.md) two people editing the same field: the second save landed and neither was told the first had happened. A property can now declare `optimisticLocking` and refuse to be written without saying what it was — **the version column the finding asks for is declined**, because a row-level counter would also clash on two people editing *different* fields | `data-layer.evaluation.test.ts` |
| [04 §3.9, §3.10](./04-infrastructure-subsystems.md) a hot key expiring on the multi tier cache sent every concurrent caller to the origin at once, and its hit-rate dashboard read a permanent zero because the counters it declared were never incremented. **§3.10 was filed as minor and was not**: the in-memory store keyed entries by object identity, so a key like `{ userId, tenantId }` never hit the cache at all — while the same declaration on valkey, which resolves the key to a string, cached normally | `caching.evaluation.test.ts`, `in-memory.cache-store.test.ts` |
| [04 §3.6, §3.7, §3.8](./04-infrastructure-subsystems.md) the shared cache store's byte counter was a read followed by an increment, so two instances writing one key left it permanently too high — a store that then evicts to get under a limit it is not over, throws away every later write as fast as it arrives, and reads from outside as a cache that has stopped caching. Both halves of the bookkeeping are one step on the server now, which also makes removing an entry twice harmless and is what lets every instance sweep the shared store. **Two of these three were correctness findings filed as performance ones**: expiry was implemented once per cache kind and the flagship one recognized an expired entry and moved on without deleting it, leaving it in the budget while live entries were evicted around it — a store answers with what is still valid now, and a sweep gives the room back rather than waiting for a key nobody asks for twice. Only §3.7 was what its heading said: a value's size is measured rather than serialized and thrown away, exactly rather than approximately, because a budget whose estimate drifts admits more than it says it holds | `caching.evaluation.test.ts`, `in-memory.cache-store.test.ts`, `json.utilities.test.ts` |
| [01 §M23, §M24](./01-data-layer.md) a migration's version answered two questions and could not answer both, so the second schema change of a release — the ordinary case — was treated as applied the moment the first recorded itself and **silently never ran**, while reverting either one deleted both records. Identity is the class name now, which `runUp` was already writing on every row, so nothing had to be backfilled; what had to go is `version` being declared `unique`, which is the schema asserting that a release carries one change. **A second half nobody had filed closed with it**: reverts were ordered by version, which stops being an order at all once two migrations share one. §M24's two stores turned out not to disagree on purpose — valkey already resolved a to-one relation to its foreign key and postgres's single-statement upsert had never learned it — so the translation moved above both drivers, where `belongsToOne` and `manyToOne` are written as their key and the three kinds that keep their key elsewhere are refused by name | `migration-identity.test.ts`, `upsert-relations.test.ts` |
| [01 §M8, §M12](./01-data-layer.md) every number column was an arbitrary precision `numeric` read back through `Number`, so a value above 2^53 came back as a different number and a counter indexed and aggregated as a decimal. A number property now says which of four kinds it holds — `number`, `integer`, `bigint`, `bignumber` — and each is stored as something its own TypeScript type holds *exactly*, so **the precision loss becomes unreachable rather than caught**: the fix the entry asks for, refusing a value that does not round-trip, was declined for that. What it costs is the declared type having to match the format, checked at declaration time where TypeScript emits one and against the value where it does not — `number \| null` compiles to `Object`, and that union is what most nullable number properties use. §M12 was **two thirds already closed and unrevisited**, the third round running; its soft delete read the row twice, once for the guard and once for a change set that excludes the column being written. Its last third closed after that: an update no longer reads the row it just wrote, because `UPDATE … WHERE … RETURNING *` is the single operation the driver interface claimed no store has, and typeorm's `save` was reading the row a second time on top of that — **a plain `updateById` costs two statements rather than four** | `number-formats.cases.ts`, `number-format.test.ts`, `data-layer.evaluation.test.ts`, `validate-number.function.test.ts`, `updated-entity.cases.ts`, `json-column-values.test.ts` |
| [01 §M13](./01-data-layer.md) a soft deleted row kept holding the address it was registered with, so deleting an account burned that email forever. A unique declaration now says which rows it covers, and on a soft delete entity **saying nothing is refused at declaration time** — both answers are ordinary, so neither can be the default | `data-layer.evaluation.test.ts`, `soft-delete-key-declarations.test.ts`, `key-where-to-sql.test.ts` |
| [01 §M14](./01-data-layer.md) there was no `count` and no `exists`, so how many rows match was answered by reading all of them — and once M4 refused an unbounded read past ten thousand, not answerable at all above that. Both narrow through the entity's scopes, so a count reports what the caller may see rather than what is stored | `data-layer.evaluation.test.ts`, `soft-delete-repository.test.ts` *(the cursor/stream half stays open)* |
| [03 §D4](./03-auth-and-security.md) the encryption service loaded its strategies without their keys, so every strategy row that already existed came back with `keys` undefined and the service searched and pushed to it anyway. A first boot could not show it — the table is empty then, so every strategy is one the process just made and still holds its keys — which is why the only symptom was the master-rotation test failing on the *second* boot | `auth-and-security.evaluation.test.ts` |
| [01 §M15](./01-data-layer.md) every unique lookup on valkey read the whole entity | *(partial — a unique declaration is now indexed)* |
| [01 §C1](./01-data-layer.md) `synchronize` was opt-out, so a rename dropped a column on the next deploy | `schema-management.evaluation.test.ts` |
| [01 §C4](./01-data-layer.md) `CREATE EXTENSION` on every boot made superuser a condition of starting | `trigram-extension.evaluation.test.ts`, and every container-backed suite, which now boots as a role that owns its database and nothing more |
| [01 §C6](./01-data-layer.md) a backup of one application dumped the whole cluster, and wrote every role's password verifier into the artifact | `backup.evaluation.test.ts` |
| [03 §H1](./03-auth-and-security.md) every verifier of an access token had to hold the secret that signs it, which let it mint tokens too. Access tokens now take a key pair (ES256/384/512 or RS256), name it in a `kid`, and the public keys are published as a JWKS | `jwt-auth.asymmetric.test.ts` *(§H19 builds the auth routes from what is registered; §H14 takes the tokens of identity providers by their published keys; §H8 issues tokens to services by those keys; §H12 added EdDSA; §H9 was withdrawn, `@Auth.require2fa` is step-up; §H13 let it take a recent login instead)* |
| [03 §H2](./03-auth-and-security.md) a user could not sign in with the company's identity provider: the auth interfaces only had room for a POST with a password. Authenticators now prove who someone is and strategies hold the session, and an OpenID Connect sign-in (authorization code with PKCE, tied to the browser, single use) ends in the same jwt or cookie login, with Google, Microsoft Entra ID and Keycloak built in | `base-oidc.authenticator.test.ts`, `base-keycloak.authenticator.test.ts` against a real Keycloak |
| [03 §H10](./03-auth-and-security.md) there was no passwordless sign-in, and no second factor phishing cannot get past. A user now signs up and in with a passkey, bound to the site's origin, and a passkey is a second factor of an operation. A copied security key is refused and recorded, and an application can allow only the device models it names, checked against the FIDO Metadata Service | `auth-passkey.evaluation.test.ts`, `passkey.authenticator.test.ts` |
| [03 §H11](./03-auth-and-security.md) only an authenticator app could be a second factor, which left out every user without one. A code mailed to the account, or texted to a number the user confirmed, is now a second factor an application can choose: single use, kept encrypted, throttled after wrong codes like every method, and sent at most once a minute | `code.two-factor-method.test.ts` |
| [03 §H4](./03-auth-and-security.md) a password could only be checked against the user table. A user now signs in with the name and password of their account in a directory, such as Active Directory or OpenLDAP: a service account finds the entry and a bind as it checks the password, always over TLS, and the first sign-in as an entry goes through a hook of the application. **Building it found that directories refuse a locked account with three different codes**, two of which would have answered as an outage rather than a refused sign-in | `base-ldap.authenticator.test.ts`, `base-active-directory.authenticator.test.ts`, two container suites against 389 Directory Server and a Samba domain controller *(green; the cases for groups and `DOMAIN\name` added later not run yet)* |
| [03 §H3](./03-auth-and-security.md) there was no SAML 2.0, the protocol many enterprise identity providers speak. A user now signs in through one, read from its metadata, with signed requests and encrypted assertions where the provider asks for them; only the answer to the browser's own request is taken. A logout ends the session at the provider too, and the provider's logout ends exactly the logins of that session. **Building it found node-saml taking an unsigned logout request**, which would let anybody end the logins of whoever a link named | `base-saml.authenticator.test.ts`, `base-keycloak.authenticator.test.ts` *(container, not run yet)* |
| [03 §H5](./03-auth-and-security.md) a script or another service could only call the api by logging in as a person. A user, a person or a service account, now holds api keys: each named, kept hashed, limited to some of the user's roles, with an expiry, and revoked on its own. A strategy that reads such a key no longer has to pretend it starts logins | `api-key.auth-strategy.test.ts` |
| [03 §H6](./03-auth-and-security.md) a service could not call the api with a client certificate. The certificate a proxy forwards now identifies a user: taken only from the proxies the application names, and only when an authority it names issued it and it is valid now, so a proxy set to accept any certificate cannot let one claim any name. nginx, Envoy and Istio, Traefik, AWS's load balancer and the RFC 9440 header are read | `base-client-certificate.auth-strategy.test.ts`, `client-certificate-header.utilities.test.ts`, `base-client-certificate.auth-strategy.nginx.test.ts` and `.envoy.test.ts` behind a real nginx and Envoy *(container, not run yet)* |
| [03 §H7](./03-auth-and-security.md) an identity provider could neither create users ahead of time nor take away the access of someone who left. It now provisions users and groups through SCIM, with an api key: a user it sets inactive is deactivated, their logins ended and their api keys revoked, and no login or request acts as them until it sets them active again; groups set roles through a hook. **Building it found deactivation missing a user created in the same transaction** | `scim-controller.model.test.ts`, `auth.service.deactivation.test.ts` |
| [03 §H8](./03-auth-and-security.md) a service could not exchange its credentials for a short-lived token, a service receiving a token could not ask whether it was still active, and nobody outside could revoke one. The application is now an OAuth2 authorization server for the client credentials grant: an api key is the client, proving itself by its secret, a jwt it signs or a client certificate the token is then bound to; tokens name the services they are for, introspection answers for every kind of token, and revocation takes one back, at once when the application chooses that for every access token. **Building it found the form parser failing a list field sent once** | `authorization-server-controller.model.test.ts`, `jwt-auth.controller.test.ts` *(container, not run yet)* |
| [03 §H18](./03-auth-and-security.md) an application could not call a provider's apis for a user, such as their calendar: a linked identity kept no tokens. A connection or a sign-in now asks for scopes the authenticator allows, and their tokens are kept encrypted, refreshed one request at a time and handed back to the provider when the access ends. A connection says whether it also signs in, so one made for the apis is no way into the account | `auth-oauth-api-access.evaluation.test.ts`, `base-oidc.authenticator.test.ts` |
| [03 §H17](./03-auth-and-security.md) a provider that posts its answer to the callback, as Apple does, could sign nobody in: the browser left the sign-in's cookie off the post, and the cross-origin check refused the post anyway. Such a provider now gets a `SameSite=None` cookie, and its callback accepts the post from the provider's own sign-in page through `@AcceptCrossSitePosts`, which any route can use. Apple is built in | `auth-oidc-form-post.evaluation.test.ts`, `base-oidc.authenticator.test.ts`, `base-apple.authenticator.test.ts` |
| [03 §H16](./03-auth-and-security.md) a user with an account could not add a provider to it, so their next sign-in through it found nobody. A logged in user now connects one through `AuthService.startConnection`, from a route the application guards: a one-time url sends the browser to the provider with `prompt=login`, and the callback links the identity to that user, never to another. Linked identities are listed and unlinked through `AuthService` too | `auth-oauth-connect.evaluation.test.ts`, `base-oidc.authenticator.test.ts` |
| [03 §H15](./03-auth-and-security.md) a provider without OpenID Connect, such as GitHub, could sign nobody in: the flow verified an ID token such a provider never issues. The round trip now sits in a shared `BaseOAuthAuthenticator`, and `BaseOAuth2Authenticator` reads who signed in from the provider's api instead. Such a sign-in never counts as a recent login, since the provider does not say when the user signed in. GitHub is built in | `auth-oauth2.evaluation.test.ts`, `base-oauth2.authenticator.test.ts`, `base-github.authenticator.test.ts` |
| [02 §C7](./02-http-runtime-core.md) a process could run exactly one application, ever — the lifecycle had no transition back to offline | `bootstrap.evaluation.test.ts` |
| [02 §M6](./02-http-runtime-core.md) every 5xx reached the aggregator as `"Global Error"` with an empty stack, in two handlers rather than the one the finding named | `error-logging.evaluation.test.ts` |
| [04 §3.2](./04-infrastructure-subsystems.md) every log call formatted a V8 stack trace and indexed a fixed line of it — 87µs a call, and a `TypeError` whenever the depth differed | `logging.evaluation.test.ts` |
| [01 §M22](./01-data-layer.md) `unique` was a constraint on postgres and a comment on valkey, so the framework's own rate limiter could split one limit across two rows | `valkey-durability.evaluation.test.ts` |
| [02 §M13](./02-http-runtime-core.md) a route registered on the router reached no authorization at all, and there was no way to give it any — the framework's own OpenAPI surface among them, which now declares its posture through `OPEN_API_AUTH` rather than having none to declare | `manual-routes.evaluation.test.ts` |
| [02 §M7](./02-http-runtime-core.md) a correlation id was defined and read by nothing, so an id a caller quoted matched no line in the log — closed twice over, since tracing then retired the private id in favour of the standard one it turned out to be | `http-and-observability.evaluation.test.ts`, `error-logging.evaluation.test.ts` |
| [02 §M10](./02-http-runtime-core.md) a multipart body was bounded by bytes and not by parts, so a thousand one-byte files tied up a thousand file descriptors — and the refusal arrived as a connection reset the caller retried | `http-and-observability.evaluation.test.ts` |
| [02 §M1](./02-http-runtime-core.md) a download that failed mid-stream threw from inside its own error listener, leaked the socket, and ended the process | `streaming.evaluation.test.ts` |
| [02 §C5](./02-http-runtime-core.md) `start()` resolved and logged *"is running on port"* before the bind failed — and after it succeeded, one connection the server could not accept ended the process | `bootstrap.evaluation.test.ts` |
| [02 §M5](./02-http-runtime-core.md) nothing ever told a request context which route it matched, so `@CurrentUser`'s `required` and `allowedStrategies` did nothing — a route accepting only a session was identified by a bearer token | `request-context.evaluation.test.ts` |
| [02 §M4](./02-http-runtime-core.md) the caller was resolved once per check; the cache meant to prevent that was dead code that would have answered the wrong question if revived | `request-context.evaluation.test.ts` |
| [02 §M2](./02-http-runtime-core.md) every json response was serialized, parsed and serialized again — and a websocket broadcast did that once per recipient rather than once per message | `http-and-observability.evaluation.test.ts` |
| [02 §M11](./02-http-runtime-core.md) no response compression and node's own five-minute request timeout, so a client sending a byte a minute held a socket for as long as it liked *(partial — HTTP/2 and in-process TLS stay open)* | `http-and-observability.evaluation.test.ts` |
| [02 minor](./02-http-runtime-core.md) the router lowercased `request.method`, so express could never answer `304` and answered `HEAD` with a body — filed as a courtesy problem for third-party middleware, found by the test written to prove the ETag row wrong | `http-and-observability.evaluation.test.ts` |
| [02 §M3](./02-http-runtime-core.md) a route's declaration was resolved on every request that reached it — which also meant a route saying two contradicting things booted cleanly and served a 500 to whoever called it first, and that a lookup handed out the very array the route's roles were kept in | `route-metadata.evaluation.test.ts` |
| [06 §CD1, §CD4](./06-tooling-ci-and-testing.md) the release job built the published tarball from a dependency graph it resolved itself rather than from the lockfile, and produced no provenance attestation despite requesting the permission for one. **§CD2, the CRITICAL beside them, was withdrawn**: the test gate it looked for is a branch protection rule on `release`, which a workflow file cannot show | `di-and-packaging.evaluation.test.ts` |
| [05 §P1, §P2](./05-di-metadata-and-packaging.md) + [06 §CI4](./06-tooling-ci-and-testing.md) `import { ZibriApplication } from 'zibri'` was `ERR_MODULE_NOT_FOUND` for every ESM consumer: the entry point the package advertised was never emitted, and the build behind it produced CommonJS in a folder named `esm`. Closed by shipping one build — a dual package would give a consumer two `DiContainer` singletons — and by the first test here that loads the built package instead of `src` | `published-package.test.ts` |
| [05 §D1, §D9](./05-di-metadata-and-packaging.md) the container could not say why it failed: a dependency cycle was `RangeError: Maximum call stack size exceeded` with a trace of nothing but its own frames, and a class decorated after startup was unresolvable with an error telling you to add the decorator it already had | `di-and-packaging.evaluation.test.ts` |
| [05 §D2](./05-di-metadata-and-packaging.md) singleton-or-transient was the whole scope model, so a service needing the current user or tenant could not be built per request and had to reach into `AsyncLocalStorage` at call time. Request scope now lives on the request context, whose lifetime it shares — with the two errors that keep it from becoming a subtler leak than the thing it replaced: asking for one outside a request, and building one into something that outlives the request | `di-container.test.ts`, `request-context.evaluation.test.ts` |
| [05 §D3, §D4](./05-di-metadata-and-packaging.md) unregistering a token left whatever had been built under it live and injectable forever, because `inject` reads the instance cache before it looks at a provider. **§D3 is fixed against a different target than it named**: duplicate detection in `register` would outlaw overriding a default, which is the documented way to configure the framework — what nobody decides is two plugins claiming one token, where the winner is whichever plugin is listed first | `di-and-packaging.evaluation.test.ts` |
| [05 §D5](./05-di-metadata-and-packaging.md) a constructor parameter whose type the metadata could not keep — an interface, a union, a generic, a primitive, or a class caught in an import cycle — was injected as the built-in TypeScript falls back to, so the reader was told there was no provider for `Object`: a token they never wrote, about a class the message did not name. The parameter's own position, class and file are now what the error is made of | `di-container.test.ts`, `di-and-packaging.evaluation.test.ts` |
| [05 §D6](./05-di-metadata-and-packaging.md) a value that does not exist until something has been awaited — a connection, a vault secret, a warmed cache — could not be a provider at all, which is what pushed that work into the lifecycle hooks. `useAsyncFactory` is awaited once during initialization and cached like any other value; `inject()` is refused inside one, on both sides of its awaits, because a factory that reaches an already-resolved value works and is one reordering away from not working | `di-container.test.ts`, `di-and-packaging.evaluation.test.ts` |
| [04 §2.7](./04-infrastructure-subsystems.md) a queued thread job was a row nothing ever read back: a restart abandoned the in-memory queue and left rows at `IN_PROGRESS` forever. A shutdown now marks running work `INTERRUPTED` — its own state, because a job that ran halfway is not one that never started — and startup takes back everything unfinished. A killed process writes nothing, so its rows are judged by the job's own `timeout`, which a healthy owner would have enforced. **At-least-once, and the docs say so**: distinguishing a crashed owner from a live one exactly needs a per-job heartbeat, which is a feature rather than a repair | `multithreading.service.test.ts` |
| [04 §2.9](./04-infrastructure-subsystems.md) a thread job could carry a function, which was persisted as source and turned back into code when the job was requeued — so write access to `ThreadJobEntity` was write access to a worker thread. A function is no longer something a job can be *persisted* with: the queueing paths name a file, `run` keeps taking a function and never writes a row, and a runtime check backs the type up for callers who are not reading it. **The same shape as §D6** — what has to outlive the moment it was written cannot be a closure, so it has to be something nameable | `multithreading.service.test.ts` |
| [04 §2.8](./04-infrastructure-subsystems.md) a worker thread that hit an `uncaughtException` reported it and carried on, then went back on the idle list — so whatever the throw left half done, module scope and the cached functions included, was handed to the next tenant of that thread. It ends itself now, reporting first so the error still reaches the job. **Making it exit re-opened §2.6 through a new door**: freeing the worker on an error message put a thread already on its way out back in the pool, and the next job was posted to it — so an error message now says whether the worker is coming back | `multithreading.service.test.ts` |
| [04 §2.3, §2.4](./04-infrastructure-subsystems.md) a subscriber whose hook threw was written down as having run, so the event flipped to `FINISHED` and the cleanup job deleted it a day later — the failure was recorded in a column three separate readers never looked at. A run now carries where it stands rather than only that it happened, an event whose subscribers gave up is `FAILED` and is kept, and the attempts that used to be a microsecond-long loop are one per delivery with a doubling backoff. **The two findings are one defect**: the loop could not wait because a run had nowhere to be recorded as unfinished | `event.service.test.ts`, `event-cleanup.cron-job.test.ts` |
| [05 §D7](./05-di-metadata-and-packaging.md) two copies of `zibri` in one process — a lockfile that could not dedupe, a plugin that installed its own — gave it two containers and two registries that could not see each other, and said nothing. Startup now counts the copies through the one registry the whole realm shares and refuses to run on more than one, naming `npm ls zibri` and `peerDependencies`. **Sharing a container between them was rejected**: the classes would still be distinct, so `instanceof` would go on quietly answering no across the seam — most of a fix, plus a class of bugs with no visible cause | `framework-copies.test.ts` |
| [06 §CI1, §CI2](./06-tooling-ci-and-testing.md) one node version, one operating system, and no supply-chain gate of any kind. A check of the tree a consumer installs (licenses against a permissive policy, and high advisories, optional peers included), dependency review on every pull request, and CodeQL are jobs now rather than intentions, and a `portability` matrix runs Windows and macOS beside Linux carrying the two suites that need no container — which are also the two that live in the filesystem, where the platforms actually differ. **The node matrix is derived, not written down**: a `>=` range promises versions that do not exist yet, so CI reads node's own release schedule and tests every line that has started and not ended at or above the floor — a new one the week it ships, without an edit | `ci-workflows.test.ts` |

| [04 §5.1](./04-infrastructure-subsystems.md) every worker thread registered a TypeScript compiler the moment it started, before it had been told what to run — and `generateEntityFiles` imported one at the top of a file the barrel re-exports, so `require('zibri')` resolved `ts-node` before an application had done anything at all. It is registered on demand now, only for a worker file that is actually TypeScript, and reached through `require` at the point of use rather than an import — which is what lets it be **optional rather than removed**: npm installs a peer unless the meta says otherwise, so `optional` is what keeps it out of a production image while still telling a consumer who wants TypeScript workers what to install | `optional-peer-dependencies.test.ts` |
| [01 §M25](./01-data-layer.md) a failed thread job and a failed charge each recorded their error in a `jsonb` column typed `Error` — whose `message`, `stack` and `cause` are all non-enumerable, so the row said something had failed and nothing whatever about what. Both are `LoggedError` now. **The guard the finding proposes cannot work**: `emitDecoratorMetadata` gives a decorator `design:type` `Error` for `error?: Error` but `Object` for `Error \| null`, and both defects were `Error \| null` — a decorator-level check would have passed while the two columns it was written for stayed broken. The guard reads source instead, and found exactly those two | `serialized-error-columns.test.ts` |
| [06 §CD3](./06-tooling-ci-and-testing.md) the release built and published one package at a time, so `npm run build -w cli` failing left `zibri` on the registry with no cli to match it. **A publish cannot be rolled back** — npm allows an unpublish for 72 hours and then never again — so the fix is not to start a release that will fail halfway: read the version, refuse it if the registry already has it, build all three, rehearse all three, then publish. The version had to come from somewhere, and the three manifests are hand-edited, so a release whose packages disagree is now refused before anything is built | `ci-workflows.test.ts` |
| [05 §P4](./05-di-metadata-and-packaging.md) the published tarball installed **50MB, 37.6MB of it the framework's own HTML coverage report** — written into `src/__testing__/coverage`, gitignored, and shipped anyway, because `files` is a whitelist that beats every ignore rule underneath it. 232 test files came with it. It installs 10.26MB now, with the source tree kept on purpose so the maps beside `dist` point at something and a reader following a framework method arrives at what it does. **The exclusion has to be written without a leading `./`** — `"!./src/__testing__"` is silently inert where `"!src/__testing__/**"` works, which is the kind of difference that keeps a wrong answer looking like a right one. **It came back through the other door and the test caught it**: 93 compiled test files in `dist`, from a build that compiled none of them, because `tsc` removes nothing and `files` ships the directory rather than the build's output. CI could never have seen it — it builds into a fresh checkout, so the only machine where `dist` has a history is the one a manual publish would run from. The build empties `dist` first now | `published-package.test.ts` |
| [04 §5.1b](./04-infrastructure-subsystems.md) the test written for §5.1 found that **13 of the 14 peers were needed to load `zibri` at all**, three of the four the manifest called optional among them — a top level import of an optional peer means the whole package cannot be loaded without it, which is the opposite of what the word says. Ten are optional now, and the rule that shaped it is the project's rather than the finding's: **a check belongs where a feature is declared, never where it is used**, which the framework already makes cheap by constructing every registered token while it starts. So a missing package is a boot failure naming it, not a stack trace on the first invoice, first handshake or first enrolment months later | `optional-peer-dependencies.test.ts`, `di-and-packaging.evaluation.test.ts` |
| [04 §4.3](./04-infrastructure-subsystems.md) every outbound call went out through node's default `fetch` with nothing but a signal on it, so a corporate egress proxy, a custom CA bundle and a client certificate could not be named at all — and a deployment whose network policy mandates all three, which is most of the ones that have a network policy, could not make Zibri obey it. The six things the finding lists turn out to be **one** option: keep-alive, `maxSockets`, pooling, proxy, CA and mTLS are all how an undici `Dispatcher` is built. **Three measurements shaped it** — node 24's `fetch` does honour a per-call dispatcher, so this is scoped to the client rather than installed with `setGlobalDispatcher` over every other library in the process; `undici` is not importable, so the framework builds none of them; and `undici-types` is a hard dependency of `@types/node`, which is the only reason the option is exactly typed instead of `unknown`. The payment plugin needed no change — it already went through `HTTP_CLIENT` | `http-client.evaluation.test.ts` |
| [04 §3.3, §3.4](./04-infrastructure-subsystems.md) the logger buffered a batch and then unpacked it, calling every transport once per entry — one INSERT per log line, and one queued mail per log line, so a dependency failing at ten thousand errors a minute queued ten thousand mails whose backlog outlived the incident by hours. `LoggerTransportSend` takes `Log[]` now, `logToDb` is one `createAll`, and the email transport sends a digest bounded both by size and by rate, naming what it left out. **The test found the half the finding does not name**: batching alone changed nothing, because a drain started the instant an entry arrived, so the first entry of every quiet period was written alone — and an application logging one line per request is quiet between requests, so every access log line would still have been its own INSERT. Entries need somewhere to gather, which is what `LOGGER_FLUSH_INTERVAL_MS` is | `logger.batching.test.ts`, `log-to-email.digest.test.ts` |
| [04 §5.2](./04-infrastructure-subsystems.md) the mail transport was nodemailer, built in `EmailService`'s own constructor, so sending through SES, SendGrid or Postmark meant subclassing the service and overriding a `protected` method — which **two of this repository's own fixtures did**, and is the finding proved rather than argued. `EmailTransportInterface` is the seam now, `SmtpEmailTransport` is what ships, and the connection details left `EmailConfig` for it, so an option type no longer advertises `host` and `port` to a deployment that has neither. **There is no default transport**, deliberately: every one of them needs a server or an api key only the deployment knows, and defaulting to smtp would make the choice invisible again. What needed writing down is which of two things a transport does when it cannot deliver — throwing means the mail never left and stays `QUEUED`, answering with `rejectedRecipients` is the provider's verdict and ends it. **One of the two overrides had drifted** past [§2.2](./04-infrastructure-subsystems.md): it deleted a failed mail the real send keeps and never wrote `rejectedRecipients`, so the suite's own FAILED test had been green for a different reason than production | `email-transport.evaluation.test.ts`, `email-failure.evaluation.test.ts` |

| [05 §M2](./05-di-metadata-and-packaging.md) `strict: true` and nothing beyond it, under a README claiming everything public is "as strictly typed as possible". Six options are on now — `noUncheckedIndexedAccess` and five smaller ones — and the 412 errors they raised are gone from `src` and the tests alike. **Two of the three defects the finding named had already been fixed by other rounds, and the flag found four nobody had listed**: `/metrics` answering 500 on a host that reports no network interface, a `NaN` ready time refusing a satisfiable reservation as `QUEUE_TOO_LONG`, a multipart field the model does not declare answering 500 where a json body reports the unknown key, and `addImportStatement` silently returning a side-effect import unchanged so generated code was missing an import until it failed to compile. The argument for a compiler flag is the class of defect it forecloses, not the instances somebody wrote down. **`exactOptionalPropertyTypes` was declined**: it checks no code, it splits `foo?: string` from `foo: string \| undefined` across every optional property in the public API, and the answer differs per property — a modelling pass with a breaking change at the end, not the tail of a strictness round | `metrics.service.test.ts`, `sliding-window-log.rate-limiter.test.ts`, `form-data.body-parser.test.ts`, `add-import-statement.function.test.ts` |
| [05 §M1](./05-di-metadata-and-packaging.md) a company standardised on esbuild or Vite could not build a Zibri application, and nothing said so. **The migration the finding implies is not available** — standard decorators have no parameter decorators and no metadata emit, and the container reads both — but the lock it names turned out to be one compiler option rather than a metadata model: without `emitDecoratorMetadata` every decorator still compiles, and what it writes is read in exactly two places. So the promise is two styles rather than one toolchain — an application that names its tokens builds under esbuild, Vite and Bun — stated where a reader chooses their toolchain and held by compiling one application four ways. **The test found the container building a class with no arguments at all** where the metadata was absent: the parameter count came from the metadata too, so §D5's whole error was unreachable and every dependency arrived as `undefined`, failing at the first method to use one | `build-toolchains.test.ts` *(`tsc`, `tsc` without the option, SWC and esbuild, each loaded in a process of its own)* |

| [06 §T2](./06-tooling-ci-and-testing.md) the testcontainers-backed harness — the single most valuable DX asset here — was framework-internal, so every adopting team wrote their own. It is `zibri-testing` now: a package rather than the `./testing` subpath the finding asks for, which is what keeps `testcontainers` out of the framework's peer list and stops a subpath committing the framework to jest. **Two of the three costs the finding names had already evaporated**: the jest coupling was a `process.exit` spy whose comment described behaviour fixed back in 02 §C5, and the container coupling dissolved with the packaging. The real work was splitting a harness from this repository's furniture — what ships is what is wrong *for a test* (a work factor sized for an attacker, a scheduler that fires on its own, a limit written for real callers), what stayed is this repository's user, versions and templates. **It also proves the data-source abstraction is implementable from outside**, which was an untested claim: the in-process data source needed four more exports and nothing else | `di-and-packaging.evaluation.test.ts`, `in-memory-data-source.test.ts` |
| [06 §T3](./06-tooling-ci-and-testing.md) nothing documented how to test a Zibri application. Writing the page found that the harness answered the wrong question: it built a server out of parts a test listed, which is right for the framework's own suite and wrong for a consumer, who has an application already — one assembled from the parts it remembered to list is adjacent to the thing it is testing. `startTestServer` takes the application's own exported options now and resolves each key **call, then application, then harness default**. That meant the application had to become exportable: `zi new` wrote it inline inside `start()`, and now scaffolds it as three modules — what the application is, where it stores that, and what a test replaces — a split **forced** by 05 §M4's registry, which refuses a data source that is registered without being deployed. Two defects fell out: an option that is present and undefined took away the default `ZibriApplication` would have filled in, and a cluster instance naming no providers got the cron and multithreading *stubs*, so five cluster scenarios could not fail for the reason they were written | `application.options-base.test.ts`, `new.command.sandbox-parity.test.ts` |
| [06 §C4](./06-tooling-ci-and-testing.md) never assessed: whether `zi new` output is production-shaped. It was not, and the first thing the assessment found was that **the generated `src/providers.ts` did not parse** — an array element with no comma after it, in every project the cli has ever created, recorded as an *accepted sandbox difference* in the file whose job is to tell intended divergence from breakage. Nothing had ever read the generated code as code; the fast suite parses it now. Beside it: the jwt signing secrets and the encryption master key were literal placeholders published with the cli, and the seeded administrator's password was `'password'` — while `docs/auth.md` had been showing `process.env` for those values all along. Configuration is environmental now, on `process.loadEnvFile()` and therefore no new dependency, with a generated `.env` so that "refuse to boot when a variable is missing" costs a new project nothing. There was also no `.gitignore` at all, in a scaffold whose own docs told the reader to add an entry to it | `new.command.sandbox-parity.test.ts` |
| [07 Part 1](./07-documentation-vs-code.md) twenty-two claims the code did not support, of which **sixteen were stale rather than answered**: closing some other finding changed a required option or a type, and the page demonstrating it was never revisited — `defaultAuth` became required, `CURRENT_REQUEST_CONTEXT` widened to a union, `FsPath` became branded, `Repository`'s constructor grew to six arguments. That is a process defect, so it closed as a test rather than as an edit: **every documented example compiles on every run**, one module per page, checked against the framework's own source under the options `zi new` scaffolds. A page is the unit because roughly three in five blocks are excerpts of what came before them — per-block would have meant a boilerplate import on about 140 examples to check nothing new. **Three of the examples that would not compile were right about an api that was wrong**: `Omit` over a union collapses to the common keys, so every form-data-only body option was documented, implemented and unreachable; `Sha256HashStrategy` and `CompressionOptions` are named by DI tokens and were never exported; and `changePropertyOfEntity` took an old name the entity no longer carries but not a new one, so the `down()` of a rename could not be typed at all. The README was checked the same way — `engines` says Node 24 and the quick start asked for 22 | `docs-examples.test.ts` |
| [05 §M4](./05-di-metadata-and-packaging.md) `import { ZibriApplication } from 'zibri'` **did not start an application**. The barrel exports both shipped plugins, `@Controller` registers at module load, and startup builds every registered token — so `MailingListController` was constructed in an application that never heard of it and demanded a table it has no reason to carry. **This repository structurally could not see it**: all 127 suites import relative paths, never the package's own name, so the barrel never loads. The first test run of `zibri-testing`, which imports `zibri` the way a consumer does, failed on it immediately. An `allowOrphan` controller the application did not declare is now dropped from the container before any sweep — the flag already said it may go unused; that it is not built either was the missing half | `application.orphan-registrations.test.ts` |
| [05 §M4](./05-di-metadata-and-packaging.md) the same thing one decorator over, and the entry's own residue was the wrong thing to look at. Importing a module registered every `@Injectable` it declares and startup **built** all of them, so an application constructed services it had never heard of and ran their lifecycle hooks — a package's services executing inside every consumer that imported the module for something else. Initialization now builds a class only when it declares a hook, which is readable off the prototype without constructing anything. **The application-level fix changed nothing observable on its own**: five services answer "does anything look like a cache, a rate limiter, a body parser, a user repository without being decorated as one?" by constructing the entire container to duck-type the instances, and shutdown resolved every registered token so it could ask each one to tear down — a constructor running for the first time on the way out. The `register: 'onUse'` hole closed with it, after a startup check was written and thrown away for firing on three legitimate cases in a row: **what is decidable at startup is what nobody wants, and what is decidable at injection is what somebody wants** | `application.orphan-registrations.test.ts` |

**Opened while fixing those**, none of which were in the original review — every one came from
using the framework rather than reading it:

| Finding | |
|---|---|
| [04 §1.3b](./04-infrastructure-subsystems.md) | scheduled work starts before the app is listening, so a pod that never becomes ready still runs the nightly job |
| [04 §1.4b](./04-infrastructure-subsystems.md) | `emit` only knows about subscribers in its own process — narrowed and **confirmed red** by `cluster/heterogeneous-events.cluster.test.ts`. The originally described case turned out to work by accident; what breaks is two *different* subscribers split across roles |
| [05 §D9](./05-di-metadata-and-packaging.md) | `@Injectable` registration is a one-shot snapshot; being late produces an error that blames the decorator. Hit three times — **fixed**, by having `inject` consult the global record it already consulted for lazy injectables |
| [05 §D10](./05-di-metadata-and-packaging.md) | defining a data source you never use fails boot — **fixed**, with `allowOrphan` and by comparing class identity rather than class name, which had been letting a factory's identically named classes vouch for each other |
| [07](./07-documentation-vs-code.md) | the documented `subscribe` example does not compile — **fixed**, by removing the type parameter it needed. A DI token carries one type and hands every consumer that same type, so a generic on the service had to be instantiated at the token, which could only name the widest map there is. An application declares what it emits by merging into `ZibriEventMap` instead |
| [04 §2.7b](./04-infrastructure-subsystems.md) | **Fixed.** The two places the framework loads a *consumer's* file used `require()`, which failed for an ESM file on the versions `engines` claimed to support. The floor is now `>=24`, where `require` loads all three kinds — and the half no version fixes went with it: an ESM worker file ran only for the first job on a thread, because it cannot be dropped from the module cache the way a CommonJS one is |
| [10 §10.1](./10-leases-and-claims.md) | `withLock` expired under its own holder, which then deleted somebody else's lock. Observed peak occupancy of three replicas in a section meant for one — **fixed** |
| [10 §10.2](./10-leases-and-claims.md) | an event claim was never renewed, so a slow subscriber ran repeatedly — and the replica that lost the claim exited with code 1 — **fixed** |
| [03 §E5](./03-auth-and-security.md) | the rate limiter's compare-and-set retried three times with no delay, and every writer that lost did so at the same instant — so they retried into the same race and a burst became an `InternalError` from the limiter itself. Eight attempts with a random wait in a doubling window; the randomness matters more than the count. §2.3 in another subsystem — **fixed** |
| [06 §T4](./06-tooling-ci-and-testing.md) | the thread job worker is started from `dist`, correctly — but only CI builds before testing, so a local run exercises whatever the last build contained. Caught by it twice in one sitting: one worker fix's test was red against eight-day-old code, and the other's **passed without testing anything**. The suite now refuses a build older than its source, and the weak test was replaced by one that compares thread ids — **fixed** |
| [01 §M25](./01-data-layer.md) | an `Error` written to a column keeps `{}` of it: `message`, `stack` and `cause` are non-enumerable, and `@Property.unknown` is `jsonb`. `ThreadJobEntity.error` and `Payment.error` are each the only record of their failure and each say nothing about it. Survived because every assertion on those columns checks that they are *defined*, and `{}` is. Found while fixing 04 §2.4, whose third instance is now a `LoggedError` |
| [10 §10.2a](./10-leases-and-claims.md) | `updateById` on a deleted row inserted it back instead of failing — **fixed** |
| [04 §4.3](./04-infrastructure-subsystems.md) | a **type-only** dependency can still be the wrong one. Typing `HttpClientOptions.dispatcher` as undici's own `Dispatcher` looked free, because `undici-types` reaches every project through `@types/node` — but at whatever version their `@types/node` major pulls, and **this repository's three workspaces carry undici-types 6, 7 and 8 at once**. A `Dispatcher` from one is not assignable to a `Dispatcher` from another (v8 widened `UndiciHeaders`), so any version named is wrong for somebody and the option refuses the `ProxyAgent` it exists to accept. `tsc` sees none of this: it resolves the nearest copy. The type is described by the framework now, to the one member it touches — none, since it forwards a dispatcher and never calls it — and all three majors satisfy it — **fixed** |
| [10 §10.3](./10-leases-and-claims.md) | queued mail was claimed per cron tick rather than per row, so a slow send was re-sent by the next slot — **fixed** |

[10-leases-and-claims.md](./10-leases-and-claims.md) is a category rather than a subsystem, and it
is the most important thing this exercise produced. Closing the Tier 1 items one at a time closed
the instances but not the class: every one of them granted work to a replica **once**, for a **fixed
duration**, and then ran without rechecking that it still held it.

All four are now fixed, and each fix landed on the same three mechanisms — identify the grant,
renew it while working, fail loudly when it is gone. Three independent implementations of one idea
is the evidence that it belongs in one place, which is what that document's *Toward one primitive*
section now argues from rather than predicts.

It also records what was checked and found *safe*, so the next audit does not repeat the work.

**Still open at Tier 1**: nothing, with one qualification. The mail rate limiter was withdrawn —
configuration, not a defect. [01 §M20](./01-data-layer.md) has since closed: `updateAll` is one
driver operation on both stores, with rows that stopped matching left alone, and phantoms are its one
documented limit.

An earlier version of this paragraph said every fix above routes around that. **That was wrong**, and
the distinction matters for what to do next. Of the five:

| Fix | Shape | Would a conditional update have changed it? |
|---|---|---|
| Cron lease | unique `INSERT` on (job, scheduled time) | **No** — the row *is* the claim; there is no prior row to update |
| Event subscriber run | unique `INSERT` | **No** — same, the run row is created at claim time |
| `withLock` | advisory lock / `SET NX PX` | **No** — a critical section is not a row claim |
| Invoice numbering | `atomicUpsert` | **No** — a counter, and `INSERT … ON CONFLICT DO UPDATE` is its own primitive |
| **Mail send claim** | separate `EmailSendClaim` table | **Yes** — the `Email` row already exists in `QUEUED`; this is the textbook case |

So one of five genuinely routed around the gap, and it is the one that grew an extra entity to do
it. The others are insert-shaped on their own merits and would not be rewritten.

**That last row has since been overtaken.** Designing the fix for it produced a larger conclusion —
that transactions and leases are the only two coordination primitives this framework needs, and that
`withLock`, `atomicUpsert`, the cron lease, the event claim and the mail claim are all one of the
two wearing a different name. Under that model the mail queue stops claiming by updating, so §M20
loses its concrete requirement and becomes a user-facing gap rather than a blocking one. The model
is written up in [10, The two primitives](./10-leases-and-claims.md#the-two-primitives) and is the
next thing to be built.

---

## Tier 1 — Deal-breakers

### 1. Nothing stateful survives horizontal scaling

Every stateful subsystem is a per-process in-memory singleton. Run two replicas behind a load
balancer and the framework's headline features become incorrect — silently, with no error.

| Subsystem | Behaviour at N replicas | Evidence |
|---|---|---|
| ~~Cron~~ **fixed** | Every replica ran every job. Now every scheduled execution is claimed through a unique `CronRunLease` row, keyed by job *and* scheduled time | `cluster/cron.cluster.test.ts` |
| ~~Events~~ **fixed** | Delivery was an in-process rxjs `Subject` and the DB row a log nothing polled. Now claimed per `(event, subscriber)` and polled by every instance | `cluster/events.cluster.test.ts` |
| ~~Mail queue~~ **fixed** | `SELECT ... WHERE status='QUEUED' LIMIT n` with no claim of any kind ⇒ N copies of every email. Claimed per mail through a lease now, and asserting it no longer needs a real SMTP receiver: what delivers a mail is `EmailTransportInterface`, so the cluster fixture registers one that marks instead of transmitting (§5.2) | `cluster/mail.cluster.test.ts` |
| ~~WebSockets~~ **fixed** | A broadcast reached 1/N of users. `WebsocketOptions.adapterDataSource` now names a data source and broadcasts travel. Note the original claim that "rooms are a plain object" was wrong — real socket.io rooms were always used, there was simply no way to pass an adapter. Reconnecting to another instance works too — Zibri replays missed messages and rejoins an authenticated user's channels from the shared data source, since socket.io's own recovery cannot span instances. Request/response sends remain local | `src/websocket/data-source.websocket-adapter.ts` |
| Cache | Tag invalidation skipping multi-tier caches entirely (§1.8) is **fixed**, and so is §1.9: an invalidation is published as a row that every instance applies to its own local tiers, so a multi-tier cache's L1 is no longer stale on the replicas that did not handle the write. Coherence is eventual, bounded by the poll interval | `src/caching/cache.service.ts` |
| ~~Mail rate limiter~~ **withdrawn** | The default uses an in-memory store, but `EMAIL_RATE_LIMITER` is a `useClass` provider, so replacing it is an override — and `docs/rate-limiting.md` documents the shared-store alternative in a section written for exactly this. There is no multi-tier rate limiter, so choosing the store is the whole answer. What is left is a default-safety argument, plus that sharing limits currently requires ValKey (§1.7) | `src/email/email.rate-limiter.ts:26` |

The *"most of these have no seam"* half of this finding is **closed**. Cache stores and rate-limiter
stores were already pluggable; the event bus, cron scheduler and websocket adapter gained one while
their own findings closed; the email rate-limiter store turned out to have had one all along
(§1.7, withdrawn); and the mail transport was the last hardcoded one — `EmailTransportInterface`
now, with `SmtpEmailTransport` as what ships. See [04 §5.2](./04-infrastructure-subsystems.md). What
is left of it is a *missing implementation* rather than a missing seam: `BackupTransportInterface`
exists and only `BaseFsBackupTransport` implements it.

~~There is also a hard one-app-per-process constraint~~ — **fixed** for the case that mattered. The
lifecycle was missing its last transition, so nothing ever returned to `OFFLINE` and a process could
run exactly one application, ever. It can now run them one after another, and `shutdown()` discards
the DI container with the state. Two at *once* remains impossible and is declined rather than
deferred: decorators register declarations at module load, so concurrent applications would share
them whatever the container did. See [02 §C7](./02-http-runtime-core.md).

→ [04-infrastructure-subsystems.md](./04-infrastructure-subsystems.md) §1

### 2. Defaults that destroy data

- ~~**`synchronize` is opt-*out***~~ — **fixed**. The option is gone from `PostgresOptions`
  entirely, replaced by a required `schemaManagement: 'synchronize' | 'migrations' | 'external'`.
  Closed by making the choice required rather than by picking a default, since every value is right
  for somebody and the wrong one is only noticed after it has dropped the column.
- ~~**Migrations take no lock**~~ **fixed** — schema setup now runs inside `withLock`, on
  `DataSourceInterface`. Note the original finding named only migrations: `synchronize` was racing
  too, and hit first.
- **Down-migrations run automatically on version downgrade** —
  `src/data-source/migration/run-migrations.function.ts:50-63`. A rollback, or an old pod
  restarting mid-deploy, reverts the schema the new pods are using. The documented `down()`
  example is `throw new Error('Not implemented yet.')`.
- **Failed emails are deleted** — `src/email/email.service.ts:129-141`. A rejected mail with
  `persist: false` (the default) is `DELETE`d. No retry, no DLQ.
- **`runOnInit: true` is the cron default** — `src/cron/cron-job.model.ts:86-92`. Every pod
  restart fires every job off-schedule. Zibri's own internal jobs all override it to `false`.

→ [01-data-layer.md](./01-data-layer.md) §C1–C3

### 3. Security defaults and gaps

- **`Access-Control-Allow-Origin: *`, hardcoded and unconfigurable** **[verified]** —
  `src/http/cors.middleware.ts:11-19`. No CORS option exists anywhere. It also omits `PATCH`
  from allowed methods and omits the framework's own `x-csrf-token` / `x-authorization-otp`
  headers from allowed headers, so a cross-origin browser client physically cannot send the
  CSRF token or the 2FA code. It short-circuits every `OPTIONS` with a 200, making
  `HttpMethod.OPTIONS` routes unreachable.
- **Routes are open by default with no warning** — `src/auth/auth.service.ts:211-288`. A route
  with no `@Auth.*` metadata skips every check. The only warning emitted is the *inverse* case.
- **JWT access tokens cannot be revoked; role checks never hit the DB** —
  `src/auth/strategies/jwt/jwt.auth-strategy.ts:330-350`. A terminated employee keeps `ADMIN`
  for up to the token lifetime (default 1h).
- **Unconfirmed TOTP enrollments satisfy 2FA** **[verified]** —
  `src/auth/2fa/methods/otp/otp.two-factor-method.ts:79-83` never checks `c.confirmed`, though
  `confirmRegisterForUser` sets it at line 59.
- **No rate limiting or lockout on any built-in auth endpoint.** Not one route in
  `jwt-auth.controller.ts` carries `@RateLimited`.
- **Secrets stored in plaintext**: password-reset tokens, TOTP seeds, refresh tokens, CSRF
  tokens — none use the framework's own `hash` / `encryption` property flags.

→ [03-auth-and-security.md](./03-auth-and-security.md)

### 4. No enterprise identity, at all

Verified absent from the entire codebase: OIDC, OAuth2 (client or M2M), SAML, LDAP/AD, SCIM,
JWKS, asymmetric JWT signing, mTLS, API keys, token introspection, step-up auth, WebAuthn,
multi-tenant identity primitives. 2FA is TOTP-only.

`AuthStrategyInterface` is extensible in principle, but its shape is
`login(credentials)` / `refreshLogin` / `requestPasswordReset` / `confirmPasswordReset` — a
local-password model. A redirect-based SSO flow does not fit: there is no callback/state/nonce
plumbing, and `AuthControllerInterface` assumes POST-with-credentials. Adding SSO means
redesigning the interface, not implementing it.

No large organization runs its own password database as the primary identity source. This is a
procurement-stage rejection.

→ [03-auth-and-security.md](./03-auth-and-security.md) §H

### 5. The observability floor is below the enterprise bar

- ~~**Every 5xx logs identically with an empty stack**~~ — **fixed**. The error that was thrown is
  logged, with its stack; `GlobalError` is kept only for a thrown value that is not an `Error`, which
  is the case it exists for. The websocket handler had the same defect and the finding had not
  noticed it.
- ~~**Nothing is logged for any `HttpError`**~~ — **fixed, and not the way this asked.** Logging every
  client error would put a warning on a missing favicon. The security-relevant ones reach the record
  through the audit trail ([03 §G1](./03-auth-and-security.md)), with a reason a detection rule keys
  on; a 429 was the one gap and now has `AuditAction.RATE_LIMITED`; the rest are the access log's job.
- ~~**Auth failures are swallowed by bare `catch`**~~ — **fixed**. The three bare catches are gone, so
  a user-store outage now propagates instead of being reported as a refused credential, and
  `has2fa` records the difference rather than dropping it.
- ~~**No correlation.** `CORRELATION_ID` is defined in two places and consumed by nothing~~ —
  **fixed**: a middleware puts every request into a trace, and its id reaches the response header,
  the error body, every log line of that request and every outbound call the http client makes while
  handling it. ~~**No OpenTelemetry, no tracing hooks**~~ — **fixed** as well, and it is what closed
  the line above: the correlation id was the trace id under a private name, so there is one id now
  rather than two. Correlation makes an incident findable and tracing makes it explicable, and the
  same `traceparent` does both. ~~No access log, no request duration~~ —
  **fixed**, behind `ZIBRI_DI_TOKENS.ACCESS_LOG` and off by default, since metrics already answer the
  aggregate questions more cheaply. See [02 §M6](./02-http-runtime-core.md) and
  [02 §M7](./02-http-runtime-core.md).
- **Prometheus cardinality bomb** **[verified]** — `src/metrics/metrics.service.ts:105` uses
  `req.originalUrl ?? req.route?.path`. `originalUrl` is always defined and includes path
  params *and* query string, so the templated route path is dead code. Each distinct URL
  creates ~11 series with no eviction. Unauthenticated remote OOM.

→ [02-http-runtime-core.md](./02-http-runtime-core.md) §M6–M7,
  [04-infrastructure-subsystems.md](./04-infrastructure-subsystems.md) §3.1

### 6. Operational lifecycle

- ~~**No in-flight request draining and no readiness signal**~~ — draining is **fixed**: the drain is
  bounded by `HTTP_DRAIN_TIMEOUT_IN_MS`, after which `closeAllConnections()` ends what is left. The
  readiness half was **withdrawn** rather than fixed: the framework knows nothing the application
  does not, since `server.listen()` runs only after initialization completes, and the `preStop`
  timing it would serve has to be sized against a specific ingress. Documented as a project and
  deployment concern in [replication.md](../packages/zibri/docs/replication.md); reasoning in
  [02 §C3](./02-http-runtime-core.md).
- ~~**`process.exit(0)` unconditionally**, even if every shutdown hook threw~~ — **fixed**. A failed
  hook sets `shutdownFailed` and the process exits `1`, so an orchestrator no longer reads a clean
  exit after a broken teardown. The *"does not flush pending async log writes"* half was overstated:
  the shutdown path awaits its logging. Fire-and-forget logging elsewhere is still unflushed, which
  needs a flush contract on `LoggerTransport`.
- ~~**`server.listen()` has no error handler**~~ — **fixed**. `start()` waits for the bind, so
  `EADDRINUSE` rejects it instead of resolving, logging *"running on port 8080"* and then killing the
  process. The word the finding got most right was *anywhere*: the server keeps emitting `'error'`
  after the bind, and a connection it could not accept was reaching the `uncaughtException` handler
  and ending a process whose open connections were all fine. It now has a lasting handler that logs
  and carries on. See [02 §C5](./02-http-runtime-core.md).
- ~~**No `process.on('unhandledRejection')` or `uncaughtException`** anywhere~~ — **fixed**. Both
  handlers are installed, and the socket.io middleware no longer leaves `await`s outside its
  try/catch, so a throwing `isAllowedToConnect` fails the handshake with an error instead of
  stalling it until the client's connect timeout. See [02 §C4](./02-http-runtime-core.md).
- ~~**`ts-node` is a mandatory production peer dependency**~~ — **fixed**, and with it the rest of
  the peer surface: ten of fourteen are optional, each declared by a feature and checked while the
  application starts, leaving `bignumber.js`, `rxjs` and `zibri-tsx` (`jsonwebtoken` was a fourth,
  until `jose` replaced it as an optional peer, [03 §H12](./03-auth-and-security.md)). See
  [04 §5.1, §5.1b](./04-infrastructure-subsystems.md).

→ [02-http-runtime-core.md](./02-http-runtime-core.md) §C3–C5,
  [05-di-metadata-and-packaging.md](./05-di-metadata-and-packaging.md) §P3

---

## Tier 2 — Serious (must be fixed before rollout)

**Data access** — no index can be declared anywhere in the entity model and there is no raw-DDL
escape hatch; no optimistic locking or version column; `updateAll`/`deleteAll` materialize the
whole result set; ~~SQL is built by string concatenation including unescaped JSONB keys and entity
ids~~ **fixed**; ~~`CREATE EXTENSION pg_trgm` on every boot needs superuser~~ **fixed**;
`poolSize: 100` default;
transactions must be threaded by hand and leak pooled connections on a throwing commit; every
number column is `DECIMAL` round-tripped through strings; bulk audit rows lose the actor;
~~backups shell out to `pg_dumpall` with stored superuser credentials~~ **fixed** — and the artifact
it produced carried every role's password verifier, which the finding had not noticed;
~~a `unique` declaration is a constraint on postgres and a comment on valkey, which `upsert` depends
on being true~~ **fixed** — and the framework's own rate limiter was depending on it too.
→ [01-data-layer.md](./01-data-layer.md)

**Runtime correctness** — a crashed idle worker poisons the thread pool forever; `eval` of a
function body read from a database column; non-priority thread jobs are LIFO and starve;
uploaded temp files default into `node_modules` and the cleanup cron has an inverted predicate;
~~multipart parsing sets no busboy `limits`~~ **fixed**, and so is the refusal arriving as a
connection reset rather than a 413; ~~stream errors after headers are sent throw inside an
`'error'` listener~~ **fixed**, and with it a failed download ending the process; one transient
SMTP blip permanently disables outbound email; multi-tier
cache tag invalidation is a no-op; the HTTP client retries non-idempotent requests on any 4xx
with zero backoff.
→ [02-http-runtime-core.md](./02-http-runtime-core.md),
  [04-infrastructure-subsystems.md](./04-infrastructure-subsystems.md)

**Per-request performance** — ~~every JSON response is serialized three times~~ **fixed**, and the
websocket half of it turned out to be one normalization per recipient rather than one per message;
~~~40 metadata lookups per request each allocating a clone~~ **fixed** — a route registry now holds
what each route declared, filled while the route is registered, which also moved a refused
declaration and a developer facing warning from the first request to boot; ~~auth verified 2–4× per
request with its cache dead code~~ **fixed** — resolved once per request and keyed on what the answer
depends on, while the dead cache was deleted rather than revived, since it answered without regard to
what it was asked;
~~every log call materializes a V8 stack trace~~ **fixed**; ~~logging is awaited with one DB INSERT per
line~~ **fixed** — the awaited half went with the access log, and the per-line half needed a batch
*and* somewhere for entries to gather, since a drain that starts on the first entry batches nothing
for an application that logs once per request; validation regexes recompiled per request.
→ [02-http-runtime-core.md](./02-http-runtime-core.md) §M2–M4

**DI and packaging** — ~~no request scope and no cycle detection (a circular dependency is a stack
overflow, not a diagnostic)~~ **fixed**; ~~providers silently overwrite each other~~ **fixed**;
~~`unregister` does not evict instances and its JSDoc is false~~ **fixed**;
~~a parameter the type metadata could not keep is injected as `Object`~~ **fixed**;
`emitDecoratorMetadata` locks consumers to `tsc`;
~~the ESM build's post-processing is wrapped in `catch {}` and reads a file `tsc` did not emit~~ **fixed**.
→ [05-di-metadata-and-packaging.md](./05-di-metadata-and-packaging.md)

---

## Tier 3 — Notable

No 403 (role failures return 401, causing infinite SPA refresh loops); authorization errors leak
role names and entity class names to unauthenticated callers; password reset is a three-state
enumeration oracle *and* a denial-of-reset vector; scrypt work factor hardcoded and
unconfigurable; `needsRehash`/`needsReEncryption` are dead features; encrypted values have no AAD
binding so encrypted values are portable between rows; the default rate-limit key is the literal
string `'global'` and there is no supported way to key by IP; the distributed rate-limit lock is
TTL-based with no fencing; `req.method` is mutated to lowercase for all downstream middleware;
the hand-rolled cookie parser has last-wins duplicate handling and an unauthenticated
log-flooding DoS; middleware ordering is emergent and undocumented; ~~no compression, ETag,
HTTP/2, request timeouts or `trust proxy`~~ — **compression, the server timeouts and `trust proxy`
are fixed**, ETag was there all along and unreachable (see the method mutation below), and HTTP/2
and in-process TLS stay open.

The `req.method` mutation on that list is **not a Tier 3 item**. Lowercasing it to match the
framework's own enum broke express's own two comparisons against `'GET'` and `'HEAD'`: no response
could ever be a `304`, so every client revalidation re-downloaded the whole body, and a `HEAD` was
answered *with* one. **Fixed** by spelling the enum the way the protocol does.

---

## The three findings to lead with

If the memo has to be three bullets:

1. **The framework is single-instance by construction** (Tier 1 §1). Every "batteries included"
   feature that made it attractive is the feature that breaks at two replicas, and most have no
   extension point.
2. **Open-by-default routing plus no token revocation** (Tier 1 §3). A missing decorator is
   undetectable, and a compromised token is unrevocable. Fixing this changes the framework's
   default semantics and requires a session/introspection layer.
3. **Authentication and authorization failures produce no log records at all** (Tier 1 §5).
   Without those events, brute-force detection, incident response, and every audit control that
   depends on an access trail cannot be built on top.
