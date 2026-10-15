# Logging
The logging system in Zibri consists of the logger itself and one or multiple logger transports.

A logger transport defines WHERE a logged message goes.
Zibri provides some by default, but you can of course create your own transports:
- console logger transport (prints the log to the console)
- db logger transport (saves a log entry in a data source)
- email logger transport (sends an email with the log to a specified email)

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `LoggerInterface` | interface | Log at `debug`/`info`/`warn`/`error`/`critical` levels, `audit` for security events, and `flush` to wait for the queue |
| `AuditEvent` | type | What `audit` records: an action, an outcome, and who it was about |
| `AuditAction` / `AuditOutcome` / `AuditReason` | enums | The closed sets an `AuditEvent` is built from |
| `ZIBRI_DI_TOKENS.LOGGER` | DI token | Injects `LoggerInterface` |
| `LoggerTransport` | class | Builder for a logger transport (eg. `.console()`, `.db()`) |
| `LogLevel` | enum | Minimum level a transport should log at |
| `ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS` | DI token | Overrides the transports used by the logger |
| `ZIBRI_DI_TOKENS.LOGGER_BUFFER_CAPACITY` | DI token | How many entries may queue before the least important are dropped |
| `ZIBRI_DI_TOKENS.ACCESS_LOG` | DI token | Turns on one log entry per finished request |

## Usage
### Using the logger
You can inject the logger by its token:

```ts
// src/controllers/test.controller.ts
import { AuditAction, AuditOutcome, AuditReason, Controller, defineProvider, inject, Inject, Log, LoggerInterface, LoggerTransport, LogLevel, Repository, ZIBRI_DI_TOKENS } from 'zibri';

import { MyAuditingLogger } from '../logging/my-auditing.logger';
import { myAggregator } from '../logging/my-aggregator';

@Controller('/tests')
export class TestController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface
    ) {
        const alternative: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    logStuff(): void {
        this.logger.debug('debug message');
        this.logger.info('info message');
        this.logger.warn('warn message');
        this.logger.error(new Error('error message'));
        this.logger.critical(new Error('critical message'));
    }
    // ...
}
```

Note that none of these return a promise, so there is nothing to await. See [caveats](#caveats) for what follows from that.

An entry records the [tenant](./tenancy.md#work-outside-a-request) it was logged in, in `tenantId`.

### The audit trail
`audit` is the sixth method, and it is not a level — it is what the framework calls when something
security relevant happens. Failed and successful logins, refused routes, password reset requests, a
refresh credential presented twice: see [auth](./auth.md#what-gets-recorded) for the list and what
each one carries.

```ts
export function recordFailedLogin(logger: LoggerInterface): void {
    logger.audit({
        action: AuditAction.LOGIN,
        outcome: AuditOutcome.FAILURE,
        reason: AuditReason.REFUSED,
        subject: 'someone@example.com'
    });
}
```

It goes through the ordinary transports — `info` when the outcome is success, `warn` when it is not —
and the event itself is attached under `context.metadata.audit`, so the trail can be queried out of
the rest:

```ts
export async function readAuditTrail(logRepository: Repository<Log>): Promise<unknown[]> {
    const logs: Log[] = await logRepository.findAll({});
    return logs.map(l => l.context.metadata?.['audit']).filter(a => a != undefined);
}
```

`action` and `outcome` are the pair a detection rule keys on, and both are closed sets. `reason`
is too, deliberately: messages are localized and are allowed to change wording, so nothing worth
alerting on should have to be parsed out of one.

**`audit` is the seam.** An application that has to ship these somewhere specific — a SIEM, a
separate retention, an append-only store — replaces the logger and routes `audit` on its own, and
none of the code that emits the events has to know:

```ts
defineProvider({ token: ZIBRI_DI_TOKENS.LOGGER, useClass: MyAuditingLogger })
```

Two things it deliberately does not do. There is no event for an *allowed* request — that is an
access log, it has a different volume, and burying the refusals in one would defeat the point. And
audit entries share the retention of their level (`LOGGER_CLEANUP_AFTER_MS`), so if you need to keep
them longer than two weeks, that is a reason to route them somewhere of their own rather than to
raise the retention of every `warn` you emit.

## Configuration
You can configure the transports that should be used by adding them to your providers array:

```ts
// src/providers.ts
import { ZIBRI_DI_TOKENS, LoggerTransport, LogLevel } from 'zibri';


defineProvider({
    token: ZIBRI_DI_TOKENS.LOGGER_TRANSPORTS,
    useFactory: () => [
        LoggerTransport.console(LogLevel.INFO),
        LoggerTransport.db(LogLevel.INFO)
    ]
});
```

As you can see we provide a log level for each transport here. This is especially useful if you want to use something like the email transport, which should probably only activate for critical errors.

### How entries reach a transport

Logging never waits for a transport. An entry goes into a bounded buffer and the call returns, so nothing on a request path blocks on a database write or an SMTP conversation.

Entries then **gather for a moment before they are written**, and a transport is handed all of them at once:

```ts
LoggerTransport.create({ name: 'MyTransport', level: LogLevel.WARN, register: 'directly' }, async (logs, config) => {
    await myAggregator.send(logs);
});
```

`send` receives only the entries this transport's level admits, oldest first, and is never called with an empty list. Writing a batch as one operation is the point — one statement rather than one per line.

| Token | Meaning |
|---|---|
| `LOGGER_FLUSH_INTERVAL_MS` | How long entries gather before a write. Defaults to one second. `0` writes each entry on its own, which costs one write per log call |
| `LOGGER_BUFFER_CAPACITY` | How many entries may wait. When it is full the least important entry gives way, and the next batch carries a note saying how many were dropped |

The interval is how much a crash can lose. Shutdown flushes what is queued before the data sources close, so an orderly stop loses nothing.

Raise it for an application that logs constantly and can afford to lose more on an unclean stop; lower it to keep that window small. Note that shortening it also shortens the window entries have to find each other in — an application handling a few requests a second is quiet on a 100ms window, so each line ends up written on its own again.

### The access log

One `info` entry per finished request, carrying the method, the url, the status and how long it took:

```ts
defineProvider({
    token: ZIBRI_DI_TOKENS.ACCESS_LOG,
    useValue: true
});
```

**Reach for [metrics](./metrics.md) first.** A 404 storm, a spike of 400s after a client release and a route that got slower are all questions about counts and distributions, and `http_requests_total` and `http_request_duration_ms` already answer them — labelled by method, route and status, at a fixed cost that does not grow with traffic. That is what you build a dashboard and an alert on.

Turn the access log on when you need the individual requests rather than the shape of them: which client asked for what, in what order, with which user agent. That is a debugging and forensics question, and it is worth the cost only while you have it. The cost is real — the default transports include the database one, which keeps everything from `info` upwards, so a busy application makes the log table its busiest table. Enable it together with a transport that can take the volume, or with `LOGGER_CLEANUP_AFTER_MS` set low enough for it.

The entry is written once the response has closed, which includes a client that hung up mid-response and a request that matched no route at all.

### Finding the lines of one request

Every request belongs to a trace, and every entry written while handling it carries that trace under `context.request.traceId` and the span it was written in under `context.request.spanId`. So one report — a status, a timestamp, a screenshot — turns into the exact set of lines the request produced, rather than into a window of everything the application logged at that minute.

The trace is continued from the caller's `traceparent` header when one arrived and started here when it did not, so a request crossing several services reads as one story. The response names it back under `traceresponse`, and a failed request repeats the trace id in its body as `traceId` — which is the form it survives being pasted into a bug report. Requests the application makes with the [http client](./http-client.md) carry it onward automatically.

See [tracing](./tracing.md) for the spans inside that trace, and for what the ids mean.

## Caveats

Logging never waits for its transports. A log call stamps the entry, puts it on a queue and returns, which keeps a request from paying for a slow transport and keeps a failing transport from surfacing at whatever line happened to log — a transport that throws is reported to the console instead. Two things follow from that.

### An entry is not written when the call returns

Anything that has to *see* an entry has to wait for the queue to drain:

```ts
export async function readErrorsAfterFlush(logRepository: Repository<Log>): Promise<Log[]> {
    await inject(ZIBRI_DI_TOKENS.LOGGER).flush();
    return await logRepository.findAll({ where: { level: LogLevel.ERROR } });
}
```

This mostly comes up in tests. A test asserting something was **not** logged needs the flush just as much as one asserting it was — without it, "no entry" and "not written yet" are the same result, so the test passes for the wrong reason.

The gap is at least `LOGGER_FLUSH_INTERVAL_MS` — a second by default, since entries are deliberately given time to gather. `flush()` skips that wait rather than sitting through it.

Shutdown flushes on its own, in `onAppShutdown`, while the data sources are still open.

### The email transport sends digests, not one mail per entry

One email per log entry is how a log storm becomes a mail storm: a dependency failing at ten thousand errors a minute queues ten thousand mails, and the mail queue outlives the incident by hours while every ordinary mail waits behind it.

So the email transport sends **one mail per batch**, and two options bound it:

| Option | Meaning |
|---|---|
| `maxEntriesPerEmail` | How many entries one mail carries. Defaults to 20 — the rest are counted, and the subject says how many there were |
| `minIntervalMs` | The shortest gap between two mails from this transport. Defaults to one minute. Entries arriving inside the gap are counted and reported by the next mail, whose subject says how many were suppressed |

The template receives the batch:

```tsx
export const LogEmail = ({ logs }: { logs: Log[] }) => <ul>{logs.map(l => <li>{l.message}</li>)}</ul>;
```

Every configuration function — `recipients`, `subject`, `cc`, `priority` and the rest — receives the whole batch too, including the entries that did not fit in the mail.

### Entries are dropped rather than queued without limit

Nothing throttles the code producing logs any more, so the queue refuses work instead of growing. An unbounded one would turn a slow transport into an out-of-memory kill, and it would do it during an incident — exactly when the database those entries describe is already struggling.

When the queue is full the least important entry in play gives way, and among equals the oldest does. A queue full of errors will not evict one to make room for a debug line; a queue full of debug lines gives way to a single error immediately. Anything dropped is counted and reported as a warning of its own, so a gap is visible rather than something you infer from a hole in the timestamps.

The size of the queue is `ZIBRI_DI_TOKENS.LOGGER_BUFFER_CAPACITY`, 10000 entries by default.

## See also
- [Metrics](./metrics.md) — counts and durations per route, and the first place to look before enabling the access log
- [Dependency injection](./di.md) — the providers array used to override `LOGGER_TRANSPORTS`
- [Error handling](./error-handling.md) — `error`/`critical` take an `Error` instance
- [Request context](./request-context.md) — request/cache info attached to log lines
