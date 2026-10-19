# Tracing
Every request the application answers belongs to a trace, and the work it does inside that trace is recorded as spans: the request itself, every read and write of a data source, every call it makes to another service, and every piece of background work it runs.

A trace answers where the time went and which service was responsible. [Metrics](./metrics.md) answer how often and how fast in aggregate, and [logging](./logging.md) answers what happened in words. The three join on the trace id, which every log line of a request carries.

The default implementation uses OpenTelemetry.

## Key exports
| Export | Kind | Purpose |
|---|---|---|
| `TracingUtilities` | class | `trace` to record your own work as a span, `getCurrentSpan` and `getCurrentTraceContext` to read what is running |
| `TracerInterface` | interface | What records spans. Implement it to record through something other than OpenTelemetry |
| `TraceSpanInterface` | interface | One piece of work: `recordAttribute`, `recordAttributes`, `recordError`, `updateName`, `end` |
| `TraceSpanContext` | type | What identifies a span and the trace it belongs to |
| `TraceSpanKind` / `TraceSpanStatus` | enums | What kind of work a span covers and how it ended |
| `TraceSpanAttributes` | type | What a span records besides its name and duration |
| `TraceSpanRecord` | class | One finished span, as it is read back |
| `TraceBufferInterface` | interface | Holds the spans recorded most recently: `findRecentSpans`, `findSpansOfTrace` |
| `InMemoryTraceBuffer` | class | The buffer registered by default |
| `ZIBRI_DI_TOKENS.TRACE_BUFFER` | DI token | Holds more or fewer spans |
| `ZIBRI_DI_TOKENS.TRACE_EXPORTER` | DI token | Sends finished spans somewhere |
| `otlpTraceExporter` | function | An exporter that sends them to a collector |
| `OpenTelemetryTracer` | class | The tracer registered by default |
| `ZIBRI_DI_TOKENS.TRACER` | DI token | Overrides the tracer |
| `TraceContextUtilities` | class | Reads and writes the `traceparent` and `tracestate` headers |

## Where spans go
Into memory, and nowhere else until you say otherwise. The most recent thousand spans are kept in the trace buffer, so an application answers what it has been doing out of a bounded amount of its own memory, with nothing deployed beside it.

Two packages carry the recording, and the default tracer names either one at startup when it is missing:

```
npm i @opentelemetry/api @opentelemetry/sdk-trace-node
```

A project made with `zi new` has them already. They are optional peers rather than dependencies, so an application that registers a tracer of its own drops both with the default it replaced.

### Reading them back
Inject the buffer and answer with what it holds:

```ts
// src/controllers/trace.controller.ts
import { Controller, Get, Inject, Response, TraceBufferInterface, TraceSpanRecord, ZIBRI_DI_TOKENS } from 'zibri';

@Controller('/traces')
export class TraceController {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.TRACE_BUFFER)
        private readonly traceBuffer: TraceBufferInterface
    ) {}

    @Response.array(TraceSpanRecord)
    @Get()
    recent(): TraceSpanRecord[] {
        return this.traceBuffer.findRecentSpans(100);
    }

    @Response.array(TraceSpanRecord)
    @Get('/:traceId')
    trace(traceId: string): TraceSpanRecord[] {
        return this.traceBuffer.findSpansOfTrace(traceId);
    }
}
```

Put it behind whatever the rest of the application is behind — a span names routes, entities and durations, which is a map of the application to anyone who reads it.

### Sending them somewhere
Register an exporter and every finished span is sent there in batches, as well as kept. `ZIBRI_DI_TOKENS.TRACE_BUFFER` is where the buffer's size is said, so both live in the same file:

```ts
// src/providers.ts
import { defineProvider, DiProvider, InMemoryTraceBuffer, otlpTraceExporter, ZIBRI_DI_TOKENS } from 'zibri';

import { requireEnv } from './env';

export const providers: DiProvider<unknown>[] = [
    defineProvider({ token: ZIBRI_DI_TOKENS.TRACE_BUFFER, useFactory: () => new InMemoryTraceBuffer(5000) }),
    defineProvider({
        token: ZIBRI_DI_TOKENS.TRACE_EXPORTER,
        useFactory: () => otlpTraceExporter({
            url: `${requireEnv('COLLECTOR_URL')}/v1/traces`,
            headers: { authorization: `Api-Token ${requireEnv('COLLECTOR_TOKEN')}` }
        })
    })
];
```

`otlpTraceExporter` speaks the protocol every tracing backend reads, and needs two more packages:

```
npm i @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources
```

| Option | Holds |
|---|---|
| `url` | The collector endpoint, including its path |
| `headers` | Sent with each export, which is where a hosted collector's api key goes |
| `timeoutMs` | How long one export may take. 10000 when nothing says |
| `concurrencyLimit` | How many exports may be in flight at once. 30 when nothing says |

Exported spans are reported under the application's own `name` and `version`, which is what a backend holding several services groups them by.

## What the framework records
| Span | Kind | Named | Recorded when |
|---|---|---|---|
| A request it answers | `SERVER` | `GET /teams/:id` | Always. Renamed to its route once one matched |
| A call it makes | `CLIENT` | `get` | Per `HttpClient` call, retries included |
| A read or write of a data source | `CLIENT` | `findAll Team` | Per driver operation, so an update that reads back is two |
| A websocket message it handles | `SERVER` | `ChatController.onMessage` | Per message, as its own trace |
| A cron tick | `INTERNAL` | the job's name | Per run, as its own trace |
| A pass over the email queue | `PRODUCER` | `sendQueuedEmails` | Per pass that found something, as its own trace |
| A backup or a restore | `INTERNAL` | `createBackup` | Per run, as its own trace |
| A thread job | `CONSUMER` | `runThreadJob` | Per run, under the trace it was queued in |

Background work gets a trace of its own rather than hanging under whatever happened to be running. A cron tick that fired while a request was in flight is not part of that request, and a trace that said otherwise would make one request look responsible for everything the schedule did.

A [thread job](./multithreading.md#tracing) is the exception: it is work something asked for, so its run is recorded under the trace it was queued in, whenever and on whichever instance it runs. One queued outside any trace gets a trace of its own.

Spans are named by what is written in the source — a route template, an operation, a job name — never by what arrived at runtime. A name taken from a url groups nothing, and a backend keeps every distinct one it has seen.

## What a trace gives you besides spans
The trace *context* is established for every request whether or not anything is exporting:

- a request carrying a `traceparent` continues that trace, and one arriving without it starts a new one
- every log line written while handling the request names the trace and the span under `context.request.traceId` and `context.request.spanId`
- the response names the trace back under `traceresponse`
- a failed request repeats the trace id in its body as `traceId`, which is the form it survives being pasted into a bug report
- every call the [http client](./http-client.md) makes while handling the request carries the trace onward, unless the call sets `traceparent` itself

That last one is what makes a trace worth having at all: a call fanning out to three services otherwise produces four sets of logs that nothing joins.

## Tracing your own work
`TracingUtilities.trace` records a function as one span. It hangs under whatever is already running, so a call inside a request becomes part of that request's trace with nothing passed down:

```ts
// src/services/search.service.ts
import { Injectable, TraceSpanKind, TracingUtilities } from 'zibri';

@Injectable()
export class SearchService {

    async rebuildIndex(documentIds: string[]): Promise<number> {
        return await TracingUtilities.trace(
            'rebuild search index',
            { kind: TraceSpanKind.INTERNAL, attributes: { 'code.function': 'rebuildIndex' } },
            async span => {
                const written: number = await this.write(documentIds);
                span.recordAttribute('db.response.returned_rows', written);
                return written;
            }
        );
    }

    private async write(documentIds: string[]): Promise<number> {
        return documentIds.length;
    }
}
```

The span ends when the function does, whichever way it ends. An error is recorded on it and rethrown, so tracing never changes what the work does or what a caller sees.

Pass `root: true` for work that is not part of whatever called it — anything scheduled, queued, or fired and forgotten.

To hang something on the span that is already running rather than opening a new one:

```ts
// src/services/pricing.service.ts
import { Injectable, TraceSpanInterface, TracingUtilities } from 'zibri';

@Injectable()
export class PricingService {

    quote(customerTier: string): number {
        const span: TraceSpanInterface | undefined = TracingUtilities.getCurrentSpan();
        span?.recordAttribute('pricing.tier', customerTier);
        return customerTier === 'enterprise' ? 0 : 99;
    }
}
```

## Recording through something else
Register a `TracerInterface` under `ZIBRI_DI_TOKENS.TRACER` to send spans somewhere OpenTelemetry does not reach. It has one method, and the framework then traces itself through it:

```ts
// src/tracing/quiet.tracer.ts
import { StartSpanOptions, TraceContextUtilities, TracerInterface, TraceSpanContext, TraceSpanInterface } from 'zibri';

import { QuietSpan } from './quiet.span';

export class QuietTracer implements TracerInterface {

    startSpan(name: string, options: StartSpanOptions): TraceSpanInterface {
        const context: TraceSpanContext = TraceContextUtilities.resolveSpanContext(options.parent);
        return new QuietSpan(name, context);
    }
}
```

Register it in `src/providers.ts` beside the others, with `defineProvider({ token: ZIBRI_DI_TOKENS.TRACER, useClass: QuietTracer })`. The buffer and the exporter go with the default it replaces — a tracer of your own decides both for itself.

`TraceContextUtilities.resolveSpanContext` is what gives the span an identity that continues its parent's trace — the log lines and the propagation depend on it, so a tracer that records nothing still has to answer with one.

A tracer must not throw. Tracing watches work, and a watcher that can fail the work is worse than no watcher.

## Caveats

### A worker records no spans
A [thread job](./multithreading.md#tracing) runs in a worker thread, which has no tracer of its own. Its run is one span, and what the worker does inside it is recorded by whatever it passes the trace on to.

### The buffer is a window, not a history
What it holds is bounded by a number of spans rather than by an age. At the handful of spans a request produces, a thousand of them is a few hundred requests — seconds of a busy service, minutes of a quiet one. It answers what is happening now; anything that has to survive being asked about tomorrow leaves through an exporter.

### Cache operations are not spans
[Cache](./caching.md) reads and writes are not recorded as spans. What they cost is already reported per cache and per operation by [metrics](./metrics.md), including hit rate, store duration and source duration.

### A span says which trace, not who
Span attributes are kept for as long as the backend keeps them and are readable by everyone who can read traces. The framework records a url without its query string for that reason, and records no headers, no bodies and no cache keys. Anything you add is your decision — put an id on a span, not a name or an address.

### Sampling belongs to the SDK
What is sampled, how spans are batched and which resource attributes they carry are the SDK's questions, answered by its own environment variables. A second set of options here would be a second way to say the same thing, and a way for the two to disagree.

### An unsampled trace still has an id
The `sampled` flag is a recommendation carried from whoever started the trace, not a claim that anything was recorded. A request that is not sampled still gets a trace id, still writes it on every log line, and still passes it on — so the logs of one request join across services whether or not any spans exist.