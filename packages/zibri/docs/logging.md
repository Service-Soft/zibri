# Logging
The logger records what your application does, at a level from `debug` to `critical`. Logger transports decide where an entry goes.

Three transports come with the framework, and you can write your own:
- console logger transport (prints the log to the console)
- db logger transport (saves a log entry in a data source)
- email logger transport (sends an email with the log to a specified email)

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `LoggerInterface` | interface | Log at `debug`/`info`/`warn`/`error`/`critical` levels, and `flush` to wait for the queue |
| `ZIBRI_DI_TOKENS.LOGGER` | DI token | Injects `LoggerInterface` |
| `Logger` | class | The default `LoggerInterface`. Replaceable through ZIBRI_DI_TOKENS.LOGGER |
| `LogContext`, `LogContextInput` | class, type | Where an entry was logged, with its metadata, request, error and collapsed count, and what you pass when you log |
| `LogRequestContext`, `LogCollapsedContext`, `LogContextMetadata` | class, class, class | The request an entry was logged during, how many entries a collapsed row stands for, and metadata of your own |
| `LoggerTransport` | class | Builder for a logger transport (such as `.console()`, `.db()`) |
| `BaseLoggerTransportConfig` | type | The name, level and registration time every transport has |
| `LoggerTransportSend`, `LoggerTransportFlush` | type, type | What a transport does with a batch of entries, and how it writes out what it holds back when the logger is flushed |
| `DbLoggerTransportOptions` | type | How many entries a minute `LoggerTransport.db` writes as rows of their own. Defaults to 1000 |
| `EmailLoggerTransportConfigInput`, `EmailLoggerTransportConfig` | type, type | The recipients, template and limits `LoggerTransport.email` takes, and the configuration it builds from them |
| `LogEmailTemplate`, `LogEmailTemplateProps` | type, type | The email component a log email is rendered with, and the entries it is given |
| `LogLevel` | enum | Minimum level a transport should log at |
| `ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS` | DI token | Overrides the transports used by the logger |
| `ZIBRI_DI_TOKENS.LOGGER_BUFFER_CAPACITY` | DI token | How many entries may queue before the least important are dropped |
| `ZIBRI_DI_TOKENS.ACCESS_LOG` | DI token | Turns on one log entry per finished request |
| `Log` | entity | One log entry: its `level`, `message`, `context` and `tenantId`. What a transport is handed, and what the db transport stores |
| `LoggedError` | class | An error as an entry carries it: its `name`, its `paragraphs` (the message and the chain of causes) and its `stackTrace` |
| `errorToLoggedError` | function | Turns an error into a `LoggedError`, its causes included |

## Using the logger
Inject the logger by its token:

```ts
// src/controllers/task.controller.ts
import { Controller, Inject, LoggerInterface, ZIBRI_DI_TOKENS } from 'zibri';

@Controller('/tasks')
export class TaskController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {}

    logAtEveryLevel(): void {
        this.logger.debug('debug message');
        this.logger.info('info message');
        this.logger.warn('warn message');
        this.logger.error(new Error('error message'));
        this.logger.critical(new Error('critical message'));
    }
    // ...
}
```

Outside a constructor, `inject(ZIBRI_DI_TOKENS.LOGGER)` returns the same logger.

None of these return a promise, so there is nothing to await. The entry is written shortly after, see [when entries are written](#when-entries-are-written).

An entry records the [tenant](./tenancy.md#work-outside-a-request) it was logged in, in `tenantId`.

## Security events
Every event the [audit trail](./audit.md) records is logged as well: at `info` when the outcome is success, at `warn` when it is not, with the event under `context.metadata.audit`. Like every other entry, these count toward the queue's capacity and the db transport's [budget](#how-many-rows-the-db-transport-writes), and are kept for the retention of their level. The audit trail keeps every event, for as long as you say.

## Configuration
Configure the transports by adding them to your providers array:

```ts
// src/providers.ts
import { defineProvider, LoggerTransport, LogLevel, ZIBRI_DI_TOKENS } from 'zibri';


defineProvider({
    token: ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS,
    useFactory: () => [
        LoggerTransport.console(LogLevel.INFO),
        LoggerTransport.db(LogLevel.INFO)
    ]
});
```

Each transport takes the lowest level it logs. Give the email transport `LogLevel.CRITICAL`, for example, to mail only critical errors.

### How entries reach a transport

A log call returns at once and never waits for a transport. Entries logged close together are handed to a transport at once:

```ts
// src/logging/aggregator.transport.ts
import { LoggerTransport, LogLevel } from 'zibri';

import { logAggregator } from './log-aggregator';

LoggerTransport.create({ name: 'AggregatorTransport', level: LogLevel.WARN, register: 'directly' }, async (logs, config) => {
    await logAggregator.send(logs);
});
```

`send` receives only the entries this transport's level admits, oldest first, and is never called with an empty list. Write them in one operation where the target allows it, such as one statement for all of them.

A transport that holds entries back takes a third argument, `flush`, which writes them out. The logger calls it on `flush()` and at shutdown, after every queued entry was sent.

| Token | Meaning |
|---|---|
| `LOGGER_FLUSH_INTERVAL_IN_MS` | How long entries gather before a write. Defaults to one second. `0` writes each entry on its own, which costs one write per log call |
| `LOGGER_BUFFER_CAPACITY` | How many entries may wait. When it is full the least important entry gives way, and the next write carries a note saying how many were dropped |

The interval is how much a crash can lose. Shutdown flushes what is queued before the data sources close, and once more after they have closed for the transports that need none, so an orderly stop loses nothing. An uncaught exception is written before the process ends on it.

Raise the interval for an application that logs constantly and can afford to lose more on an unclean stop. Lower it to keep that window small. With a short interval, fewer entries share a write: an application handling a few requests a second writes each line on its own on a 100ms window.

### How many rows the db transport writes

The db transport writes at most 1000 entries a minute as rows of their own, on each instance. Past that, entries with the same level, message and metadata become one row per kind, written when the minute ends. That row carries the first entry's message and context, and `context.collapsed` says how many entries it stands for and when the last one was logged:

```ts
// src/services/log-count.service.ts
import { Log } from 'zibri';

export function countEntries(logs: Log[]): number {
    return logs.reduce((sum, l) => sum + (l.context.collapsed?.count ?? 1), 0);
}
```

When more entries arrive at once than the budget has left, the more important ones keep their rows. Each minute keeps at most 100 kinds apart, and anything beyond them is counted in one row per level.

Set the budget on the transport:

```ts
// src/providers.ts, one of the transports
import { LoggerTransport, LogLevel } from 'zibri';

LoggerTransport.db(LogLevel.INFO, { maxEntriesPerMinute: 5000 })
```

### The access log

One `info` entry per finished request, carrying the method, the path, the status and how long it took. The query string of a request is on no entry, the access log's or any other's:

```ts
// src/providers.ts
import { defineProvider, ZIBRI_DI_TOKENS } from 'zibri';

defineProvider({
    token: ZIBRI_DI_TOKENS.ACCESS_LOG,
    useValue: true
});
```

For counts and durations per route, use [metrics](./metrics.md). `http_requests_total` and `http_request_duration_ms` are labeled by method, route and status, at a fixed cost that does not grow with traffic. Build dashboards and alerts on them.

Turn the access log on when you need the individual requests: which client asked for what, in what order, with which user agent. The default transports include the db transport, which keeps every entry from `info` up, so on a busy application the log table becomes its busiest table. The db transport writes 1000 entries a minute as rows of their own and [counts the rest](#how-many-rows-the-db-transport-writes), so on a busy application most requests are counted, not written. Enable the access log together with a transport that takes the volume, or raise the db transport's budget and set `LOGGER_CLEANUP_AFTER_IN_MS` low enough for it.

The entry is written once the response has closed. That includes a client that hung up mid-response and a request that matched no route.

### Finding the lines of one request

Every request belongs to a trace. Every entry written while handling it carries that trace under `context.request.traceId`, and the span it was written in under `context.request.spanId`. Filter by the trace id to read the lines one request produced.

The trace continues from the caller's `traceparent` header when one arrived, and starts here when it did not, so a request crossing several services reads as one. The response names it back under `traceresponse`, and a failed request repeats the trace id in its body as `traceId`. Requests the application makes with the [http client](./http-client.md) carry it onward.

See [tracing](./tracing.md) for the spans inside that trace, and for what the ids mean.

## When entries are written

A log call stamps the entry, queues it and returns. A transport that throws is reported to the console.

### Waiting for an entry to be written

To read an entry back, wait for the queue to drain:

```ts
// src/services/error-log.service.ts
import { inject, Log, LogLevel, Repository, ZIBRI_DI_TOKENS } from 'zibri';

export async function readErrorsAfterFlush(logRepository: Repository<Log>): Promise<Log[]> {
    await inject(ZIBRI_DI_TOKENS.LOGGER).flush();
    return await logRepository.findAll({ where: { level: LogLevel.ERROR } });
}
```

In a test, flush before asserting that something was logged, and also before asserting that it was not.

An entry waits up to `LOGGER_FLUSH_INTERVAL_IN_MS` before it is written, a second by default. `flush()` writes it without that wait.

Shutdown flushes on its own: after the `OnAppShutdown` hooks, while the data sources are still open, and again after the `AfterAppShutdown` hooks for the transports that need none.

### Sending entries by email

The email transport sends one mail for all the entries it is handed at once, and two options bound it:

| Option | Meaning |
|---|---|
| `maxEntriesPerEmail` | How many entries one mail carries. Defaults to 20. The rest are counted, and the subject says how many there were |
| `minIntervalInMs` | The shortest gap between two mails from this transport. Defaults to one minute. Entries arriving inside the gap are counted and reported by the next mail, whose subject says how many were suppressed |

The template receives the entries:

```tsx
// src/templates/emails/log.tsx
import { Log } from 'zibri';

export const LogEmail = ({ logs }: { logs: Log[] }) => <ul>{logs.map(l => <li>{l.message}</li>)}</ul>;
```

Every configuration function, `recipients`, `subject`, `cc`, `priority` and the rest, receives all of them too, including the entries that did not fit in the mail.

### Dropping entries when the queue is full

The queue holds `ZIBRI_DI_TOKENS.LOGGER_BUFFER_CAPACITY` entries, 10000 by default. When it is full, the least important entry in play gives way, and among equals the oldest does. A queue full of errors does not evict one for a debug line. A queue full of debug lines gives way to a single error at once.

Dropped entries are counted and reported as a warning of their own, and in the `log_entries_dropped_total` [metric](./metrics.md#what-a-snapshot-contains).

## Requirements
Your data source declares these entities:

| Entity | Needed when |
|---|---|
| `Log` | The db transport is one of `LOGGER_TRANSPORTS`, which it is by default |

How large each table grows, and what deletes its rows, is in [framework tables](./framework-tables.md).

## See also
- [Metrics](./metrics.md) — counts and durations per route, and the first place to look before enabling the access log
- [Dependency injection](./di.md) — the providers array used to override `LOGGER_TRANSPORTS`
- [Error handling](./error-handling.md) — `error`/`critical` take an `Error` instance
- [Request context](./request-context.md) — request/cache info attached to log lines
