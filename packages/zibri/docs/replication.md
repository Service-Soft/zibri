# Replication
Running more than one Zibri instance against the same data. A rolling deploy, a horizontal pod
autoscaler, or simply two servers behind a load balancer.

Nothing here is needed for a single instance. Everything here matters the moment there are two,
because the failures are quiet: both replicas believe they are the only one, both succeed, and the
duplicate only shows up in whatever the work touched - a second welcome email, a second invoice
number, a cache that never notices it went stale.

## The one requirement

**Every instance must share a data source.** That is what the coordination is built on: a claim, a
lock and an invalidation notice are all rows or keys that every replica can see. Two instances with
their own databases are two applications that happen to run the same code.

## What already works across instances

No configuration beyond the shared data source. Each is held by a test in
`src/__testing__/evaluation/cluster/`.

| Behavior | How |
|---|---|
| A cron job fires once per scheduled execution, not once per replica | A retained [lease](./leases.md) per `cron:<job>:<slot>` |
| An event is handled once per subscriber, and survives the replica that emitted it dying | `EventSubscriberRun`, claimed per `(event, subscriber)` and polled by every instance |
| A queued mail is sent once | A [lease](./leases.md) per `email:<id>`, taken before the rate limiter is asked |
| A thread job is run by one instance, and taken over when that instance stops existing | A [lease](./leases.md) per `thread-job:<id>`, held and renewed for the whole run |
| Schema setup does not race on boot, whichever `schemaManagement` you chose | A named lock over the whole schema setup |
| Invoice numbers do not collide, and roll back with their invoice | An `upsert`, not a lock — see [data-source.md](./data-source.md#making-your-own-writes-safe-across-instances) |

## What needs configuring

### Websockets

A socket belongs to the instance that accepted it. Without an adapter, `sendToAll` reaches the
clients of the sending instance only - roughly one in N - and nothing reports that the rest were
missed.

```ts
// src/providers.ts
import { Auth, Controller, defineProvider, Get, GlobalRegistry, Ms, ServiceUnavailableError, $ts, ZIBRI_DI_TOKENS } from 'zibri';

import { MyValKeyDataSource } from './data-sources';

defineProvider({
    token: ZIBRI_DI_TOKENS.WEBSOCKET_OPTIONS_INPUT,
    useFactory: () => ({
        messageRetentionInMs: Ms.DAY,
        adapterDataSource: MyValKeyDataSource
    })
})
```

The named data source must support publish/subscribe, which today means valkey. Postgres is not an
option here: `NOTIFY` caps payloads at 8000 bytes, which a broadcast can exceed.

One limit remains with the adapter in place: a send with `expectResponse: true` still only collects
answers from the sending instance's clients.

Reconnecting to a *different* instance does work. Socket.io's own connection state recovery cannot
span instances, so Zibri does that part itself out of the shared data source - it replays the
messages the client missed and puts an authenticated user back into the rooms of the channels they
belong to. Only an anonymous connection starts fresh, because nothing ties it to a channel.

See [websocket.md](./websocket.md).

### Caching

A cache backed by a store every instance shares - valkey - is coherent on its own and needs nothing.

A cache with a **local tier** is not. An in-memory L1 over a shared L2 is the fastest useful setup
and the one that goes stale: instance A invalidating a tag has no idea B is still holding the old
value in its own heap. Zibri publishes those invalidations through a `CacheInvalidation` row that
every instance polls, so tag invalidation reaches the local tiers too.

See [caching.md](./caching.md).

### Rate limiting

A rate limiter is only as shared as its store. The default in-memory store gives each replica its
own budget, so `100 requests per hour` becomes `100 × N`. Point the limiter at a store every
instance shares.

See [rate-limiting.md](./rate-limiting.md).

## What stays per instance on purpose

Some work is *supposed* to run everywhere. These jobs are declared `distributed: false`, and a
cluster-wide lease on them would be a bug, not an improvement:

| Job | Why every replica runs it |
|---|---|
| `CollectMetricsCronJob` | metrics describe the process reporting them |
| `FormDataBodyParserCleanupCronJob` | temp files are on that instance's disk |
| `RateLimitingCleanupCronJob` | prunes that instance's store |
| `EventDispatchCronJob` | every replica has to look for unclaimed events, or a dead one's work is never picked up |
| `CacheInvalidationCronJob` | every replica has to apply invalidations to its own local tiers |
| `RunQueuedThreadJobsCronJob` | every replica has its own worker pool to keep busy, and only it can see which of its workers are free |

When writing your own job, the distinction is what the work touches. Something that changes shared
state wants the default `distributed: true`. Something that maintains this process wants
`distributed: false`.

> `distributed: true` guarantees that one replica runs a given **scheduled execution**. It does not
> guarantee only one execution runs at a time. A job whose `onTick` can outlive its own interval
> must claim the individual work items it processes - the slot lease will not do it. See
> [leases.md](./leases.md).

## Defaults that assume one process per machine

One default is sized for an application that owns its host. Running N replicas per host multiplies it,
and it will not complain.

| Setting | Default | With N replicas |
|---|---|---|
| `MULTITHREADING_OPTIONS.maxThreads` | derived from `os.availableParallelism()` | each instance reserves a full machine's worth of threads |

Set it explicitly when you scale out.

`poolSize` is counted the other way round: it is per process, so what the database sees is the pool
times the number of replicas. Twenty by default, which is what one instance can keep genuinely busy.

A database serves its peak throughput at roughly two to three times its core count in active
connections, and adds latency beyond that as the backends contend for locks and buffers. A pool this
size is therefore worth having on one machine as much as on twenty. A deployment needing more
concurrency than its database has cores wants a pooler in front, since the ceiling belongs to the
server and every replica raising its own pool arrives at it together.

One other number relates to it. Work that is spread across many rows runs in chunks, `PromiseUtilities`'
default being fifty, and a chunk that ends in a query waits on the pool like anything else. Keep the
chunk at or somewhat above the pool: a chunk is a barrier, so one sized to exactly fill the pool
leaves connections idle waiting for the slowest item in the batch, while one far above it queues work
that the database is not going to get to any sooner and holds it in the heap meanwhile. Raising the
pool leaves the chunks where they are, so pass a `chunkSize` for work that should use the bigger
pool.

## Shutting down

An instance that goes away gracefully hands its work back, in this order:

1. **open requests are given `HTTP_DRAIN_TIMEOUT_IN_MS`** (ten seconds by default) to finish, and are
   ended if they do not. This runs before every shutdown hook, so the cap is what stops one long poll
   from holding up everything below it
2. **cron jobs stop firing.** A tick already running is not interrupted - stopping a job clears its
   timer and nothing else
3. **work still holding a lease is given `LEASE_DRAIN_TIMEOUT_IN_MS`** to finish, releasing its own
   claims as it goes. Anything still held after that is released anyway: the process is about to
   exit, so an immediate takeover beats making the next replica wait out a full lease
4. **data sources close**, which is why the releases above can still be written

Both timeouts have to fit inside whatever grace period the platform gives you before it resorts to
SIGKILL - thirty seconds under Kubernetes by default. The defaults leave room; if you raise one,
check the total.

The upshot is that a rolling deploy does not stall on the work the old pod was doing. A replica that
is *killed* rather than shut down cannot hand anything back, and its claims are collected by another
instance once they expire - that is what the lease durations are for.

Zibri does not expose a readiness endpoint, and deliberately so: it knows nothing your application
does not. `server.listen()` is only called after initialization has finished, so an instance never
accepts a request while it is still starting up, and whether it is going away is one boolean -
`GlobalRegistry.isAppShuttingDown()`. Add the endpoint in your own controller if you want one:

```ts
@Controller('/health')
export class HealthController {
    @Auth.skip()
    @Get('/ready')
    ready(): { ready: boolean } {
        if (GlobalRegistry.isAppShuttingDown()) {
            throw new ServiceUnavailableError($ts`Shutting down.`);
        }
        return { ready: true };
    }
}
```

Deliberately lifecycle state only, with no database check in it. A readiness probe that fails when a
shared database blips takes *every* instance out of rotation at the same moment, turning a slow
dependency into a total outage.

### Draining traffic before shutting down

This part is your deployment's job, not the framework's, because the timing depends on your ingress.

Removing an instance from a load balancer is not instant - the endpoint change has to propagate
through kube-proxy, an ingress controller, or a proxy's own config. Requests keep arriving for a
moment after the readiness flip. So the sequence you want is:

1. readiness reports not-ready, and the balancer starts removing the instance
2. the instance **keeps serving normally** for a few seconds
3. only then does it stop accepting connections and drain what is open

Step 2 is what a `preStop` hook buys, and it has to serve traffic *normally*. Answering those
requests with an error would fail traffic a balancer had every reason to send:

```yaml
lifecycle:
  preStop:
    exec:
      command: ['sleep', '5']   # longer than your ingress takes to notice
terminationGracePeriodSeconds: 45
```

The grace period has to cover the sleep plus the http drain plus the lease drain plus your own
hooks. Zibri handles everything from the SIGTERM onwards; the sleep before it is the part only your
manifest can size.

## Taking grants in a consistent order

Anything holding more than one grant at a time can deadlock, and nothing at the point of acquisition
can see it coming: one caller taking `a` then `b` while another takes `b` then `a` is enough. Decide
an order for your keys and keep to it.

This is not only about leases you take yourself - transactions and `upsert` take grants of their own,
so two transactions touching the same rows in opposite orders reach the same place.

## Further reading

- [deployment.md](./deployment.md) - what one instance is made of, and the endpoints an orchestrator
  polls to decide where to send traffic
- [leases.md](./leases.md) - the mechanism all of the above is built on, and what to use when you
  need one of your own
- [cron.md](./cron.md) - `distributed`, and how an execution is elected
- [events.md](./events.md) - claims, retries and the dispatch poll
