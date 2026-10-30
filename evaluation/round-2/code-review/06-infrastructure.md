# Infrastructure subsystems — code review

Extracted from the evaluation chapter [06-infrastructure.md](../06-infrastructure.md); `F` ids refer
to its findings. These are shape, duplication and style, with the evaluation's severity scale; Q4 is
rated MAJOR as an architecture item. Cross-cutting: [09-architecture-and-code-quality.md](./09-architecture-and-code-quality.md).

### Q1. Three files carry the whole of their subsystem — MINOR
`multithreading.service.ts` (1416 lines: pool lifecycle, selection rounds, claim handling, worker message protocol, trace plumbing, shutdown), `http-client.ts` (1241: five public methods whose signatures repeat seven generic parameters each, `:202-353`, plus retry, breaker, body reading and error building) and `cron-job.model.ts` (960: entity reconciliation, node-cron adapter, failure policy, state machine). CODE_STYLE asks for utility classes with entry points first and steps below; here the worker protocol (`handleWorkerMessage`, `:1099-1184`) and the body reader/error builder (`:1050-1241`) are the obvious extractions, and the five `HttpClient` signatures want one shared type alias.

> **Closed 2026-10-29 (user's decision: split all three).** No behavior changed. Each split moves
> steps into a `*Utilities` class beside the file, entry points first, with the state passed in.
> - **Multithreading:** `ThreadJobWorkerEventUtilities` holds the worker protocol: `handleMessage`,
>   `handleExit`, `handleError` and `toThrownError`. The service hands it a `ThreadJobWorkerEvents`
>   (`thread-job-worker-events.model.ts`) carrying what the handling does to the pool:
>   - find the job or worker, and write the job;
>   - call back in its tenant;
>   - complete or settle it;
>   - start what waits, and replace a dead worker.
>
>   `multithreading.service.ts` 1713 → 1545 lines.
> - **HTTP client:** `HttpClientBodyUtilities` holds the body reader and the error builder:
>   `readResponseBody` (which picks the reader from the declared body), `readBytesWithin`,
>   `buildReadError` and `buildResponseError`, with the deployment's ceiling passed in. The seven
>   request methods and the interface name their result with one public `HttpClientResult`
>   (`http-client-result.type.ts`, a Key exports row in `http-client.md`), instead of the repeated
>   `HttpClientResponseForBody<…HeaderMetaObjectToParamsObject<…>…>`. The generic parameter lists stay,
>   since TypeScript cannot alias a list of type parameters. `http-client.ts` 1490 → 1202 lines,
>   `http-client.interface.ts` 369 → 321.
> - **Cron:** `CronJobEntityUtilities` holds building the row and reconciling it at boot, plus
>   `isDeclaredInCode`. `CronFailurePolicyUtilities` holds:
>   - the retry loop;
>   - counting a failure with its backoff;
>   - the decision to stop, and the restart after a cooldown.
>
>   `CronJob` keeps its public and protected API: `resolveEntity` and `reconcileOnBoot` delegate, so a
>   subclass overriding them still works. `cron-job.model.ts` 1005 → 867 lines.
> - **Tests:** the in-memory cron (9 suites), multithreading (11), http client and docs suites stay
>   green. `cron.test.ts`, `multithreading.service.test.ts`, its performance suite,
>   `esm-application.test.ts` and the cron and thread job cluster suites are container-backed, yours
>   to run.

### Q2. Dead code: `CronJob.adoptDeclaredPolicy` — MINOR
`cron-job.model.ts:508-531` is a `protected` method nothing calls (grep finds only its definition); `reconcileOnBoot` (`:476-506`) superseded it and its JSDoc repeats the same paragraph. Leave-or-delete per CODE_STYLE's "mention it"; mentioned.

> **Closed 2026-10-29: already gone.** `grep adoptDeclaredPolicy` over `src` finds nothing; the
> method left with the cron rework of 06 §F6.

### Q3. Verbs that say the wrong cost — MINOR
CODE_STYLE: `getX` hands over what is there, `resolveX` does work. `InvoiceNumberService.getConsecutiveNumber` performs an upsert (`invoice-number.service.ts:128-148`), `getTemporaryConsecutiveNumber` reads the data source (`:106-119`), `PayPalClient.getAccessToken` makes a round trip (`pay-pal-client.ts:338-362`), `MultithreadingService.getDefaultTimeout` is fine, `PrometheusMetricsService.collect` is fine. Three renames.

> **Closed 2026-10-29.** `InvoiceNumberService.resolveConsecutiveNumber` and
> `resolveTemporaryConsecutiveNumber` (protected, named in `upgrading-to-3.md` under *Overridable
> methods say what they cost*), `PayPalClient.resolveAccessToken` (private).

### Q4. Three polling buses where one notification system would do — MAJOR (architecture; this is item 1 of `after-all-findings-fixed.md`)
The framework now has three independent "every instance polls a table to hear what another instance did" mechanisms: `CacheInvalidation` rows (`cache.service.ts:163-196`), `Event` rows (`event.service.ts:668-700`) and the cron sync (`cron.service.ts:240-261`), plus the thread-job and mail polls that are queues rather than buses. The cache invalidation is a pub/sub without durability, the event system is a durable pub/sub, and the cron sync is a pub/sub with one topic — the first and third are special cases of the second, and `RoleService` already invalidates through the cache bus (`auth/roles/role.service.ts`) because the event bus has no framework-emitted events: nothing in `auth/` or `tenancy/` calls `emit` (grep), so a user deletion, a membership revocation or a role change tells nobody, and an application wanting to react to one has no hook. The architectural move the user's list anticipates is: the framework declares its own `ZibriEventMap` entries (`userDeleted`, `membershipRevoked`, `cronJobChanged`, `cacheTagsInvalidated`), the cache and cron syncs become subscribers, and F10's notification channel is built once under the event service. That is the single change that removes two polls, gives applications the lifecycle hooks, and makes F9's metrics one set rather than three.

> **Closed 2026-10-26 (user's design: keep the buses apart; framework events opt-in, named by the
> application, default off).** The notification channel is §F10's `WakeUpService`, already shared by
> all three, each polled by a `PollingCronJob` that backs off. The merge into the event service was
> not made, on merit. An event runs once per subscriber across the deployment, the claim deciding
> which replica runs it. A cache invalidation has to reach every instance, since each clears its own
> local caches. The cron sync re-reads the stored jobs, which are the state rather than a message
> about it. Carrying either on the event service needs a subscriber per instance: an event row and a
> run row per instance for every invalidation, where today it is one row, and every event unfinished
> while an instance is down, until its registration lapses.
>
> The framework does not need lifecycle events of its own: the websocket and the role cache follow
> writes through 09 §Q1's observers (09 §Q6). Applications get them as an opt-in:
> - `ZIBRI_DI_TOKENS.FRAMEWORK_EVENT_NAMES` (`FrameworkEventNames`, default `{}`) maps `userDeleted`,
>   `userDeactivated`, `userReactivated`, `membershipStarted`, `membershipEnded` and `rolesChanged`
>   to event types of the application's own `ZibriEventMap`;
> - `EventTypeFor<Data>` lets only a type whose declared payload the data fits compile
>   (`UserEventData`, `MembershipEventData`, `RolesChangedEventData`).
>
> Each is emitted after commit by a write observer its domain registers in `onAppInit` only when it
> is named: `UserEventWriteObserver`, `MembershipEventWriteObserver`, `RoleEventWriteObserver`.
> Unnamed, nothing is registered, read or written. A user's change and a shared role's are emitted
> outside every tenant (`AlsUtilities.runOutsideTenant`), and a membership's and a tenant role's in
> that tenant. A membership start or end is judged against `findActiveMembership` after commit,
> since memberships declare no unique. One commented cast, in `FrameworkEventUtilities.emit`, carries
> `EventTypeFor`'s guarantee into `emit`'s signature over the open map. The events are at most once:
> an instance stopping between commit and emit loses one, which `events.md` says.
>
> Tests, red first: `event/event.service.framework-events.test.ts` (5 red, then green), covering:
> - user deleted outside every tenant;
> - deactivated and reactivated once each, and nothing for a repeat;
> - a membership started, ended, started and ended in its tenant, and nothing for a roles change;
> - an `updateAll` moving memberships between users;
> - a shared role and a tenant's role, each in their tenant;
> - a type case with `@ts-expect-error` for a payload that does not fit and a type no map declares.
>
> The default staying free is pinned by `write-observing.repository-driver.test.ts`'s cost cases,
> which run with nothing named.

### Q5. Published JSDoc that is wrong or misplaced — MINOR
`ThreadJobEntity`'s class JSDoc reads "Contains information about an invoice." (`thread-job-entity.model.ts:23-25`); `http-client.ts:707-718` carries the JSDoc for `withTraceContext` ("Passes the trace the caller is in on to the request…") immediately above `resolveMaxResponseSize`, and `withTraceContext` itself at `:780` has none. Typedoc publishes both.

> **Closed 2026-10-29.** The thread job's JSDoc had been rewritten with the queue work of 09 §Q5.
> The http client's block sits on `withTraceContext`, with its "what makes a trace worth having"
> paragraph moved to a `//` comment, as CODE_STYLE puts reasoning.

### Q6. `AnyPaymentProviderInterface` is `any` throughout — MINOR
`plugin/payment/providers/payment-provider.interface.ts:8-69` declares every method as `(…: any) => any` with a per-line lint disable, and `PaymentService` casts the results back (`payment.service.ts:102-105, 121, 130`). The comment says "loose typing for use in DI"; CODE_STYLE asks to find the model that does not need the cast. The generic `PaymentProviderInterface` with its phantom maps is the model; the erased form could be `PaymentProviderInterface<readonly PaymentMethod[], …>` with `unknown` rather than `any`, and the service's `as` casts become narrowing on `method`.

> **Closed 2026-10-29 (user's decision: fix it, with type tests).** The `any` was load-bearing and did
> not hold. A function property compares its parameters one way, so only `any` let the generic steps of
> `PaymentProviderInterface` extend it. Even so, a provider that supports a step for no method (`<M
> extends never>`) was not an `AnyPaymentProviderInterface` at all, since `any` is not assignable to
> `never`. The type tests found two more defects behind it, which together meant a method's data was
> never checked against its provider:
> - `(DataMap & Record<string, any>)[M]` is `any`, so every per-method type was `any`;
> - the provider of a method was picked by `providerNameForMethod`, typed `P[number]['name']`, which
>   is every provider.
>
> Now:
> - The steps of `AnyPaymentProviderInterface` are method signatures over `unknown`, whose parameters
>   are compared both ways. Its maps are `object`, and its eight lint disables are gone.
> - `payment-service.types.ts` picks the provider of a method by its `__supportedMethods`, and reads
>   its maps only where they name the method. A provider known only loosely takes any object and
>   every step.
> - The coverage check moved from a defaulted `_Check` parameter, which defaulted to its own
>   constraint and so never failed, into `Methods extends readonly MethodsCoveredByProviders<P>[]`.
>
> The `as` casts in `PaymentService` stay. They are now from `unknown`: a provider is found in a tuple
> at runtime, and its result is typed per provider. Tests, red first, in
> `services/payment-service.types.test.ts`: PayPal for `PAY_PAL` and a card provider of the
> application's own for `CREDIT_CARD`, which cancels but neither refunds nor reserves:
> - the providers did not fit the constraint;
> - once they did, a PayPal payment took a card token and the reverse, each payment took the other
>   provider's data, refunding and reserving by card were allowed, and a SEPA method no provider takes
>   compiled.
>
> `payment-plugin.md` says how a method is typed, and has `MethodsCoveredByProviders`.

### Q7. "Spread evenly" (item 2 of `after-all-findings-fixed.md`) — assessment, no finding
Thread jobs are work-stealing: the queueing instance starts a job at once if it has a free worker (`multithreading.service.ts:432-434`), otherwise whichever instance polls first takes it, ten candidates at a time. That spreads load by capacity, which is the right policy; one pod recovering "all" the jobs after a crash only happens when the others are full, and is self-correcting. Cron slot election is won by the instance whose timer fires first and whose insert lands first (`node-cron`'s `maxRandomDelay: Ms.SECOND`, `cron-job.model.ts:329`), so in practice one pod with the lowest store latency wins most slots — harmless for cleanup jobs, but `SendQueuedEmailsCronJob` drains the whole queue inside the winning tick (`send-queued-emails.cron-job.ts:26-31`), so mail throughput is one pod's SMTP connection pool and one pod's in-memory rate limiter. The place where spreading matters is therefore the mail queue, and the fix is the one the thread pool already has: every instance polls the queue (`distributed: false`) and the per-mail lease decides, which the claims at `email.service.ts:200-215` already make safe. The event dispatch and cache invalidation jobs are already per instance.

> **Closed 2026-10-29 (user's decision: a warning, not a change of the queue).** The rate limiter a
> cluster shares is what keeps the mail within the provider's limit, whichever pod sends it.
> `email.md` warns that the default limiter counts per instance and shows replacing
> `ZIBRI_DI_TOKENS.EMAIL_RATE_LIMITER` with a shared one; its Key exports name the token.

### Q8. "At-least-once rather than exactly-once" and "the delay of cron-driven polling" (items 5 and 6) — assessment
Exactly-once is not available to any system whose side effects leave the data source; the honest options are at-least-once with idempotent jobs (what `docs/multithreading.md:131` says) or transactional outbox for jobs whose effect *is* a write in the same store — the latter is cheap here because the row and the effect can share a transaction through `heldUntil` (`lease-options.model.ts:119-126`), and is worth documenting as the pattern. F1 and F5 are what make the current at-least-once unsafe rather than merely approximate. The polling delay: a job queued on an instance with a free worker starts immediately; otherwise up to 2 s (thread jobs), 5 s (events, mail), 5 s (cron changes) — acceptable for background work, and the "distributed flag" question from item 6 is answered by `RunQueuedThreadJobsCronJob` already being `distributed: false`; what the thread job needs is not a flag but the notification channel of F10, which removes the delay and the fan-out at once.

> **Closed 2026-10-30, the user's call: checkpoints and idempotency keys, not exactly-once.** The
> 2026-10-29 direction (exactly-once at `queueThreadJob`) and the apply-step proposal built on it were
> dropped. A lease gives exclusion, not atomicity of an effect with its record, so exactly-once would
> need the job's writes inside the main thread's transaction. Thread jobs are for compute, and writing
> an application's entities from them is out of scope. What the framework gives instead, all from the
> worker file:
>
> - `reportCheckpoint(progress, state)` stores the state on the row with the progress, under the run
>   condition, and resolves once stored. A run another instance took over gets a
>   `ThreadJobCheckpointNotStoredError`, and its checkpoint is not stored.
> - `getThreadJobCheckpoint()` hands the last checkpoint to every later run. A takeover or restart
>   resumes from it, with `progress` at the checkpoint's.
> - `getThreadJobIdempotencyKey(name)` (`<jobId>:<checkpoint number>:<name>`) and `getThreadJobId()`,
>   for effects that must not happen twice. The key stays the same across reruns of the same segment.
> - `resolveThreadJobProgress(done, total)` gives a `Percentage` without a cast.
> - `requeueThreadJob`/`rerunThreadJob` drop the checkpoint unless given `{ keepCheckpoint: true }`
>   (the user: an option, default throw away).
> - `maxAttempts` keeps counting starts (agreed).
> - The state's size is the application's business.
>
> New column `checkpoint`, added in upgrading-to-3.md's migration. Tests:
> `multithreading.service.checkpoint.test.ts` (in memory: takeover, a stale run refused, resume,
> requeue with and without the option), red before the build, and `worker/helpers.test.ts`.

### Q9. Seventeen hand-written expired-row sweepers — MINOR (extends round-2 05 §Q3)
`find src -name '*cleanup*.cron-job.ts' -o -name '*expiry*.cron-job.ts'` lists 17 cron jobs: seven under `auth/` (05 §Q3 counts four of them pushed from `init()`), and ten in the rest of the framework — `lease-cleanup`, `email-cleanup`, `event-cleanup`, `log-cleanup`, `cache-expiry-cleanup`, `backup-staging-cleanup`, `websocket-message-cleanup`, `mailing-list-confirmation-token-cleanup`, `rate-limiting-cleanup`, `form-data-body-parser-cleanup`. Thirteen of them are the same forty lines: a repository, a column compared with `before: new Date()` (or `createdAt` minus a retention), a `deleteAll`, two `info` lines, and a `distributed` flag that is true for rows and false for files. Each registers itself from a service's `onAppInit` with the same `if (!cronJobs.includes(…)) push(…)` block (eight occurrences in my area alone). The thread job table is the one queue that *forgot* its sweeper (F4), which is the cost of copying rather than declaring. A generic `ExpirySweeperCronJob` taking `(entity, column, retention, schedule)` — or an `@Entity({ expiresBy: 'cleanupAt' })` declaration the data source sweeps — would replace all thirteen, give F9 one `rows_swept_total{entity}` metric, and make a missing retention a boot error rather than a table that grows.

> **Closed 2026-10-29 with 05 §Q3 (user's decision: a declaration on the entity), where the
> closure is.** `@Entity({ expiresBy })` and one `ExpiredRowsCleanupCronJob` replace 11 jobs over 15
> entities. The thread job table already had its sweeper (F4); it keeps it, with the other jobs
> whose deletion depends on more than a date. No per-entity metric was added: the job logs what it
> removed per entity.
