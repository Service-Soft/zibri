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
| `TraceSpanKind` / `TraceSpanStatus` | enum | What kind of work a span covers and how it ended |
| `TraceSpanAttributes` | type | What a span records besides its name and duration |
| `TraceSpanRecord` | class | One finished span, as it is read back |
| `TraceBufferInterface` | interface | Holds the spans recorded most recently: `findRecentSpans`, `findSpansOfTrace` |
| `InMemoryTraceBuffer` | class | The buffer registered by default |
| `ZIBRI_DI_TOKENS.TRACE_BUFFER` | DI token | Holds more or fewer spans |
| `ZIBRI_DI_TOKENS.TRACE_EXPORTER` | DI token | Sends finished spans somewhere |
| `otlpTraceExporter` | function | An exporter that sends them to a collector |
| `OpenTelemetryTracer` | class | The tracer registered by default |
| `StartSpanOptions` | type | What a tracer is handed to start a span: its `kind`, its `parent` and its `attributes` |
| `ZIBRI_DI_TOKENS.TRACER` | DI token | Overrides the tracer |
| `TraceContextUtilities` | class | Reads and writes the `traceparent` and `tracestate` headers |

## Where spans go
Into memory, and nowhere else until you say otherwise. The trace buffer keeps the most recent thousand spans, so an application answers what it has been doing out of a bounded amount of its own memory, with nothing deployed beside it.

> [!NOTE]
> The buffer holds a number of spans, whatever their age. At the handful of spans a request produces, a thousand spans are a few hundred requests: seconds of a busy service, minutes of a quiet one. To keep spans longer, [send them somewhere](#sending-them-somewhere).

The default tracer records through two packages you install:

```
npm i @opentelemetry/api @opentelemetry/sdk-trace-node
```

A project made with `zi new` has them already. An application that registers its own tracer does not need them.

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

> [!WARNING]
> Protect this controller like the rest of your application. Spans name routes, entities and durations, which maps your application for anyone who reads them.

### Sending them somewhere
Register an exporter, and every finished span is sent there in batches, as well as kept. `ZIBRI_DI_TOKENS.TRACE_BUFFER` sets the size of the buffer, so both live in the same file:

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

`otlpTraceExporter` speaks OTLP, the protocol every tracing backend reads, and needs two more packages:

```
npm i @opentelemetry/exporter-trace-otlp-http @opentelemetry/resources
```

| Option | Holds |
|---|---|
| `url` | The collector endpoint, including its path |
| `headers` | Sent with each export, which is where a hosted collector's API key goes |
| `timeoutMs` | How long one export may take. 10 seconds by default |
| `concurrencyLimit` | How many exports may be in flight at once. 30 by default |

Exported spans are reported under the application's own `name` and `version`, so a backend holding several services tells them apart.

Sampling and batching are set through the OpenTelemetry SDK's own environment variables, such as `OTEL_TRACES_SAMPLER` and `OTEL_BSP_SCHEDULE_DELAY`.

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

Background work starts a trace of its own. A cron tick that fires while a request is in flight is not part of that request's trace.

A [thread job](./multithreading.md#tracing) is the exception: it is work something asked for, so its run is recorded under the trace it was queued in, whenever and on whichever instance it runs. One queued outside any trace gets a trace of its own. The worker thread it runs in has no tracer, so its run is one span. What the worker does inside it is recorded by whatever it passes the trace on to.

[Cache](./caching.md) reads and writes record no span. [Metrics](./metrics.md) report them per cache and per operation, including hit rate, store duration and source duration.

Spans are named by what is written in the source, such as a route template, an operation or a job name. A name never contains what arrived at runtime, so spans of the same work group together in a backend.

## What a trace gives you besides spans
The trace *context* is established for every request, whether anything exports or not:

- a request carrying a `traceparent` continues that trace, and one arriving without it starts a new one
- every log line written while handling the request names the trace and the span under `context.request.traceId` and `context.request.spanId`
- the response names the trace back under `traceresponse`
- a failed request repeats the trace id in its body as `traceId`
- every call the [http client](./http-client.md) makes while handling the request carries the trace onward, unless the call sets `traceparent` itself

So the logs of a call that fans out to three services join on one trace id.

This holds for a trace that is not sampled too. The `sampled` flag is a recommendation carried from whoever started the trace. A request that is not sampled still gets a trace id, writes it on every log line and passes it on, whether or not any spans exist.

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

The span ends when the function does, whichever way it ends. An error is recorded on it and rethrown, so tracing changes neither what the work does nor what a caller sees.

Pass `root: true` for work that is not part of whatever called it: anything scheduled, queued, or fired and forgotten.

To add to the span that is already running, without opening a new one:

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

> [!WARNING]
> Span attributes are kept for as long as the backend keeps them, and everyone who can read traces can read them. Put an id on a span, never a name or an address. The framework records a URL without its query string, and records no headers, bodies or cache keys.

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

Register it in `src/providers.ts` beside the others, with `defineProvider({ token: ZIBRI_DI_TOKENS.TRACER, useClass: QuietTracer })`. The buffer and the exporter belong to the default tracer: a tracer of your own decides where its spans go.

`TraceContextUtilities.resolveSpanContext` gives the span an identity that continues its parent's trace. Log lines and propagation read that identity, so a tracer that records nothing still returns a span with one.

> [!WARNING]
> A tracer must not throw. An error it throws fails the work it traces.

## Requirements
| Package | Used for |
|---|---|
| `@opentelemetry/api` | Recording spans with the default tracer. You install it |
| `@opentelemetry/sdk-trace-node` | Recording spans with the default tracer, and handing them to the buffer and the exporter. You install it |
| `@opentelemetry/exporter-trace-otlp-http` | Sending spans to a collector over OTLP, with `otlpTraceExporter`. You install it |
| `@opentelemetry/resources` | Naming the application on the spans it exports. You install it |

## See also
- [Metrics](./metrics.md) — how often and how fast, in aggregate
- [Logging](./logging.md) — the log lines of a request, found by its trace id
- [Http client](./http-client.md) — the calls that carry the trace onward to other services
- [Multithreading](./multithreading.md#tracing) — how a thread job is recorded under the trace it was queued in
