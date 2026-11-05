# Background work
Work that does not belong to the request in front of it: reacting to something that happened, running heavy code off the event loop, sending mail, doing something on a schedule, or telling the other instances that something changed. Each of these has its own tool, and they differ in what survives a restart, what is retried, and on how many instances the work runs. This page helps you pick one.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `QueuedWorkEntity` | class | What every row of queued work holds besides its own columns: `attempts`, `nextAttemptAt` when it is due again, and the `error` its last attempt failed with |
| `QueuedWorkHandedBackError` | error | Thrown by an attempt that hands its work back rather than failing, such as a backup stopped because the application is shutting down. The attempt is not counted |

## Choosing a tool
| Use | When |
|---|---|
| [Events](./events.md) | Something happened, and other code should react to it later, each subscriber once, retried when it fails |
| [Thread jobs](./multithreading.md#queueing-and-running-a-thread-job) | Heavy work should run off the event loop, and still be done after a restart |
| [`run`](./multithreading.md#running-a-function) | Heavy work should run off the event loop while the caller waits for it |
| [Queued mail](./email.md#queueing-an-email) | A mail should be sent, retried while the mail server cannot be reached |
| [Cron jobs](./cron.md#defining-a-cron-job) | Work should run on a schedule |
| [Polling cron jobs](./cron.md#polling-for-work) | Instances should pick up rows of your own as they appear |
| [`withLease`](./leases.md#taking-a-lease) | Only one instance may do a piece of work at a time |
| [Invalidation listeners](./caching.md#keeping-your-own-memory-coherent) | Every instance keeps something in memory that a write makes stale |
| [Websocket messages](./websocket.md#sending-messages) | Connected clients should hear of something now |

To react to a user, a [membership](./glossary.md#membership) or a role changing, name the events you want, see [hearing of users, memberships and roles](./events.md#hearing-of-users-memberships-and-roles).

## What each one guarantees
| Tool | Survives a restart | Retried | Runs |
|---|---|---|---|
| Events | Yes | Up to the `attempts` of the subscriber, with a growing delay | Once per subscriber across every instance: at least once, at most once or in a transaction, as its [`delivery`](./events.md#choosing-how-a-hook-is-delivered) says. Or on [every instance](./events.md#running-on-every-instance), best effort |
| Thread jobs | Yes | Taken over when its instance dies, up to `maxAttempts` starts. A job that throws ends `FAILED` | On one instance with a free worker, at least once |
| `run` | No | No | In the process that called it |
| Queued mail | Yes | While the send throws, up to `maxSendAttempts` times | On one instance |
| Cron jobs | The schedule, and a [missed run can be caught up](./cron.md#catching-up-a-run-that-was-missed) | As its [`onFailure`](./cron.md#when-a-tick-throws) says | On one instance per scheduled time, or on every instance with `runsOn: 'everyInstance'` |
| Polling cron jobs | The rows are yours | As your job does it | As the cron job is configured |
| `withLease` | No | No | On the instance holding the grant |
| Invalidation listeners | No | No | On every instance, at once on the one that invalidated |
| Websocket messages | With `persist`, replayed to a client that reconnects | No | To the connections the message is sent to, on every instance |

At least once means a run can be repeated after an instance stops at the wrong moment. Make work whose side effects must not happen twice safe to repeat.

How quickly another instance picks up work is in [how an instance finds work](./replication.md#how-an-instance-finds-work).

## See also
- [Events](./events.md) — emitting and subscribing, retries and failed events
- [Multithreading](./multithreading.md) — thread jobs and the worker pool
- [Cron](./cron.md) — schedules, and polling for rows of your own
- [Leases](./leases.md) — work only one instance may do
- [Replication](./replication.md) — what works across instances, and how they find work
