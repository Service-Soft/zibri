# Replication
Replication is running more than one instance of your application against the same data: a rolling
deploy, a horizontal pod autoscaler, or two servers behind a load balancer. Cron jobs, events,
queued mails and thread jobs then run once across all instances, and an instance that shuts down
hands its work to the others.

A single instance needs nothing from this page. When two instances do the same work, no request
fails. The duplicate shows up only in what the work touched, such as a second welcome mail or a
cache that missed an invalidation.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT` | DI token | Names the `adapterDataSource` that carries websocket messages between instances |
| `ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS` | DI token | Sets `maxThreads`. Defaults to a full machine's worth per instance |
| `ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS` | DI token | How long open requests may take to finish on shutdown. Defaults to ten seconds |
| `ZIBRI_DI_TOKENS.LEASE_DRAIN_TIMEOUT_IN_MS` | DI token | How long work holding a lease may take to finish on shutdown. Defaults to ten seconds |
| `EventSubscriberRun` | entity | The claim of one subscriber on one event |
| `CacheInvalidation` | entity | A tag invalidation every instance applies to its local cache tier |
| `TransactionDeadlockError` | error | Thrown at one of two transactions that wait for each other |
| `PromiseUtilities` | class | Runs work over many rows in chunks of `chunkSize`. Defaults to fifty |
| `defineProvider` | function | Provides a value under a DI token |
| `Ms` | class | Durations in milliseconds, such as `Ms.DAY` |

## The one requirement

**Every instance uses the same data sources.** Claims, locks and invalidation notices are rows or
keys in them, which every instance sees. Two instances with databases of their own are two separate
applications that run the same code.

## What already works across instances

These need nothing beyond the shared data source:

| Behavior | How |
|---|---|
| A cron job fires once per scheduled execution, not once per replica | A retained [lease](./leases.md) per `cron:<job>:<slot>` |
| An event is handled once per subscriber, and survives the replica that emitted it dying | `EventSubscriberRun`, claimed per `(event, subscriber)` and polled by every instance |
| A queued mail is sent once, by any instance, attachments included | A [lease](./leases.md) per `email:<id>`, taken before the rate limiter is asked. An [attachment](./email.md#attaching-files) carries its content |
| A thread job is run by one instance, and taken over when that instance stops existing | A [lease](./leases.md) per `thread-job:<id>`, held and renewed for the whole run |
| Schema setup does not race on boot, whichever `schemaManagement` you chose | A named lock over the whole schema setup |
| Invoice numbers do not collide, and roll back with their invoice | An `upsert`, see [data-source.md](./data-source.md#making-your-own-writes-safe-across-instances) |

## What needs configuring

### Websockets

A socket belongs to the instance that accepted it. Without an adapter, `sendToAll` reaches only the
clients of the sending instance, about one in N, and nothing reports the rest. Name a data source
that carries messages between instances as `adapterDataSource`:

```ts
// src/providers.ts
import { defineProvider, Ms, ZIBRI_DI_TOKENS } from 'zibri';

import { CacheDbDataSource } from './data-sources';

defineProvider({
    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
    useFactory: () => ({
        messageRetentionInMs: Ms.DAY,
        adapterDataSource: CacheDbDataSource
    })
})
```

The named data source has to carry messages of any size, as a `ValKeyDataSource` does. A
`PostgresDataSource` carries messages of up to 8000 bytes, which a broadcast can exceed, and
cannot be named here.

A send with `expectResponse: true` collects the answers of the clients of every instance.

A client that reconnects to a different instance gets the messages it missed, and an authenticated
user is put back into the rooms of the channels they belong to. An anonymous connection starts
fresh.

See [websocket.md](./websocket.md).

### Caching

A cache whose store every instance shares, such as `ValKeyCacheStore`, needs nothing.

A cache with a local tier, such as an in-memory L1 over a shared L2, gets the tag invalidations of
the other instances. Each invalidation is written as a `CacheInvalidation` row, and every instance
applies it to its own local tier.

See [caching.md](./caching.md).

### Rate limiting

A rate limiter shares its budget through its store. The default in-memory store gives each replica a
budget of its own, so `100 requests per hour` becomes `100 × N`. Point the limiter at a store every
instance shares.

See [rate-limiting.md](./rate-limiting.md).

## How an instance finds work

Events, queued mails and thread jobs, cache invalidations and changes to cron jobs are rows, and
every instance looks for the ones it can act on. The instance that adds one wakes the others, and
they look at once. While an instance finds nothing it looks less and less often, up to every 30
seconds, so a deployment with nothing to do hardly asks its data source anything. A caller waiting
for a thread job another instance runs, or for a grant another instance holds, is told when it ends.

Waking the others takes a data source that carries messages between instances, as a
`PostgresDataSource` and a `ValKeyDataSource` do, and it is the one the rows are kept in. On one
that carries none, every instance looks at every tick of its schedule.

Work that a killed instance left unfinished is found at the pace of an idle poll: within about 30
seconds after its claim lapses.

See [polling for work](./cron.md#polling-for-work) to poll for rows of your own the same way.

## What stays per instance

These jobs run on every replica, and are declared `distributed: false`:

| Job | What it works on |
|---|---|
| `CollectMetricsCronJob` | The metrics of its own process |
| `FormDataBodyParserCleanupCronJob` | The temp files on its own disk |
| `RateLimitingCleanupCronJob` | Its own rate limiter store |
| `EventDispatchCronJob` | The unclaimed events, including the ones a dead replica left |
| `CacheInvalidationCronJob` | The invalidations, applied to its own local tiers |
| `RunQueuedThreadJobsCronJob` | Its own worker pool, which only it sees the free workers of |

For a job of your own, look at what the work touches. Work that changes shared state keeps the
default `distributed: true`. Work that maintains this process uses `distributed: false`.

> [!NOTE]
> `distributed: true` runs each **scheduled execution** on one replica. Two executions can still
> overlap, when `onTick` outlives its own interval. A job like that claims each work item it
> processes, see [leases.md](./leases.md).

## Defaults that assume one process per machine

One default is sized for an application that has its host to itself. Running N replicas per host
multiplies it, and nothing warns about it:

| Setting | Default | With N replicas |
|---|---|---|
| `MULTITHREADING_OPTIONS.maxThreads` | derived from `os.availableParallelism()` | each instance reserves a full machine's worth of threads |

Set it explicitly when you scale out.

The `poolSize` of a `PostgresDataSource` is per process, so the database sees the pool times the
number of replicas. It defaults to twenty. For more concurrency than the database has cores, put a
connection pooler in front of the database, and leave the pool of each instance as it is.

Work spread across many rows runs in chunks, fifty by default in `PromiseUtilities`, and a query in a
chunk waits on the pool like any other. Keep the chunk size at or a little above the pool size.
Raising the pool leaves the chunks as they are, so pass a `chunkSize` for work that should use the
bigger pool.

## Shutting down

An instance that goes away gracefully hands its work back, in this order:

1. **open requests get `HTTP_DRAIN_TIMEOUT_IN_MS`** (ten seconds by default) to finish, and are
   ended after that. This runs before every shutdown hook
2. **cron jobs stop firing.** A tick already running is not interrupted
3. **work still holding a lease gets `LEASE_DRAIN_TIMEOUT_IN_MS`** to finish, and releases its own
   claims as it goes. What is still held after that is released, so another replica takes it over at
   once
4. **data sources close**, after the releases above are written

Both timeouts, plus your own hooks, have to fit inside the grace period the platform gives before it
sends SIGKILL. Kubernetes gives thirty seconds by default. The defaults fit. Check the total when
you raise one.

A rolling deploy then does not wait on the work the old pod was doing. A replica that is killed
instead of shut down hands nothing back. Another instance collects its claims once they expire.

An instance takes requests only once it has started, and its readiness endpoint answers `503` from
the moment it begins shutting down, see [health endpoints](./deployment.md#health-endpoints).

### Draining traffic before shutting down

A load balancer takes a few seconds to stop sending requests to an instance that reports not ready.
Give your deployment a `preStop` delay that covers this, see
[draining traffic before shutting down](./deployment.md#draining-traffic-before-shutting-down).

## Taking grants in a consistent order

Anything holding more than one grant at a time can deadlock: one caller taking `a` then `b` while
another takes `b` then `a` is enough. Decide an order for your keys and keep to it.

Transactions and `upsert` take grants of their own as well. When two transactions touch the same rows
in opposite orders, one of them fails with a `TransactionDeadlockError` and the other goes on, see
[using transactions](./data-source.md#using-transactions).

## See also

- [Deployment](./deployment.md) — what one instance is made of, and the endpoints an orchestrator
  polls to decide where to send traffic
- [Leases](./leases.md) — the tool all of the above is built on, and how to take one of your own
- [Cron](./cron.md) — `distributed`, and how an execution is elected
- [Events](./events.md) — claims, retries and the dispatch poll
