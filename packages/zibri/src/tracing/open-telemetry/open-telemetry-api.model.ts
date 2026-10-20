import { TraceSpanAttributeValue } from '../trace-span-attributes.model.ts';

/**
 * What `@opentelemetry/api` calls a span context.
 */
export type OpenTelemetrySpanContext = {
    /**
     * The trace, as 32 hex characters.
     */
    traceId: string,
    /**
     * The span, as 16 hex characters.
     */
    spanId: string,
    /**
     * A bit field whose lowest bit is the sampling decision.
     */
    traceFlags: number,
    /**
     * Whether the context was taken off an incoming request rather than started here.
     */
    isRemote?: boolean,
    /**
     * The vendor state, as the object form the api passes around.
     */
    traceState?: OpenTelemetryTraceState
};

/**
 * The vendor state, which the api keeps parsed and serializes on demand.
 */
export type OpenTelemetryTraceState = {
    /**
     * Writes the state back out as the header spells it.
     */
    serialize: () => string
};

/**
 * How a span ended, as the api states it.
 */
export type OpenTelemetrySpanStatus = {
    /**
     * The numeric status, read off the api's own enum rather than written down here.
     */
    code: number,
    /**
     * Why, when there is anything to say.
     */
    message?: string
};

/**
 * What a tracer provider is built with.
 */
export type OpenTelemetryTracerProviderConfig = {
    /**
     * What gathers finished spans and hands them on.
     */
    spanProcessors: OpenTelemetrySpanProcessor[],
    /**
     * Who is reporting the spans, which is what a backend groups them by.
     */
    resource?: OpenTelemetryResource
};

/**
 * What describes the thing spans are recorded for.
 *
 * Opaque here: the package that builds one states it is not implementable by anyone else, so the
 * only thing done with it is to hand it back.
 */
export type OpenTelemetryResource = object;

/**
 * The part of `@opentelemetry/resources` the framework uses.
 */
export type OpenTelemetryResources = {
    /**
     * Describes the reporting service by what is known about it.
     */
    resourceFromAttributes: (attributes: Record<string, string>) => OpenTelemetryResource
};

/**
 * What the api hands back for a started span.
 */
export type OpenTelemetrySpan = {
    /**
     * What identifies the span.
     */
    spanContext: () => OpenTelemetrySpanContext,
    /**
     * Renames the span.
     */
    updateName: (name: string) => unknown,
    /**
     * Records attributes. An undefined value is dropped by the api rather than written.
     *
     * The only way attributes are written here, although the api also takes them one at a time:
     * `setAttribute` is the name of a DOM method, and a call to one that is not a DOM element reads
     * to every linter as a mistake.
     */
    setAttributes: (attributes: Record<string, TraceSpanAttributeValue | undefined>) => unknown,
    /**
     * Records an error against the span.
     */
    recordException: (error: Error | string) => unknown,
    /**
     * Sets how the span ended.
     */
    setStatus: (status: OpenTelemetrySpanStatus) => unknown,
    /**
     * Finishes the span.
     */
    end: () => void
};

/**
 * A context object, which the api treats as opaque and so does this.
 */
export type OpenTelemetryContext = object;

/**
 * What a span is started with.
 */
export type OpenTelemetrySpanOptions = {
    /**
     * The numeric kind, read off the api's own enum rather than written down here.
     */
    kind: number,
    /**
     * What is known about the work already.
     */
    attributes?: Record<string, TraceSpanAttributeValue | undefined>,
    /**
     * Starts a new trace, ignoring whatever the given context holds.
     */
    root?: boolean
};

/**
 * What the api hands back for a named instrumentation.
 *
 * Named for the api rather than after the thing it is, because `OpenTelemetryTracer` is the
 * framework's own class that wraps one.
 */
export type OpenTelemetryApiTracer = {
    /**
     * Starts a span.
     */
    startSpan: (name: string, options: OpenTelemetrySpanOptions, context?: OpenTelemetryContext) => OpenTelemetrySpan
};

/**
 * The part of `@opentelemetry/api` the framework uses.
 *
 * Described here rather than imported, for the reason a `Dispatcher` is described rather than
 * imported: a type taken from a package is coupled to that package's major, and this one is an
 * optional peer that a consumer installs at whichever version their SDK asks for. What is written
 * down is the subset that is called, which has been stable across every major the package has had.
 */
export type OpenTelemetryApi = {
    /**
     * The tracing surface.
     */
    trace: {
        /**
         * The tracer for one named instrumentation.
         */
        getTracer: (name: string, version?: string) => OpenTelemetryApiTracer,
        /**
         * Puts a span context into a context object, which is how a remote parent is handed over.
         */
        setSpanContext: (context: OpenTelemetryContext, spanContext: OpenTelemetrySpanContext) => OpenTelemetryContext
    },
    /**
     * The empty context, which a remote parent is put into.
     */
    ROOT_CONTEXT: OpenTelemetryContext,
    /**
     * Parses a `tracestate` header into the object form the api passes around.
     */
    createTraceState: (rawTraceState?: string) => OpenTelemetryTraceState,
    /**
     * The kinds of work a span can cover, as the api numbers them.
     */
    SpanKind: Record<'INTERNAL' | 'SERVER' | 'CLIENT' | 'PRODUCER' | 'CONSUMER', number>,
    /**
     * The ways a span can end, as the api numbers them.
     */
    SpanStatusCode: Record<'UNSET' | 'OK' | 'ERROR', number>
};

/**
 * What sends finished spans somewhere.
 *
 * Opaque here: it is built by the exporter package and handed straight to a span processor.
 */
export type OpenTelemetrySpanExporter = object;

/**
 * A moment, as the sdk states one: whole seconds and the nanoseconds after them.
 *
 * Two numbers rather than one, because a double cannot hold nanosecond resolution and a unix
 * timestamp at the same time.
 */
export type OpenTelemetryHrTime = [number, number];

/**
 * A finished span, as a processor is handed one.
 */
export type OpenTelemetryReadableSpan = {
    /**
     * What the work is called, as it was named when it ended.
     */
    name: string,
    /**
     * The numeric kind, as the api's own enum numbers them.
     */
    kind: number,
    /**
     * What identifies the span.
     */
    spanContext: () => OpenTelemetrySpanContext,
    /**
     * What identifies the span it ran inside, absent for the root of a trace.
     */
    parentSpanContext?: OpenTelemetrySpanContext,
    /**
     * When the work started.
     */
    startTime: OpenTelemetryHrTime,
    /**
     * How long it took.
     */
    duration: OpenTelemetryHrTime,
    /**
     * How it ended.
     */
    status: OpenTelemetrySpanStatus,
    /**
     * What was recorded on it.
     */
    attributes: Record<string, TraceSpanAttributeValue | undefined>
};

/**
 * What collects finished spans and hands them on.
 *
 * Written out rather than left opaque because the framework implements one as well as being handed
 * ones the sdk built. Every method is called by the sdk, including on a span it decided not to
 * sample, so none of them may be slow and none may throw.
 */
export type OpenTelemetrySpanProcessor = {
    /**
     * Called as a span starts, with the span and the context it was started in.
     */
    onStart: (span: unknown, parentContext: unknown) => void,
    /**
     * Called once a span has finished.
     */
    onEnd: (span: OpenTelemetryReadableSpan) => void,
    /**
     * Sends everything held, without shutting down.
     */
    forceFlush: () => Promise<void>,
    /**
     * Sends everything held and stops.
     */
    shutdown: () => Promise<void>
};

/**
 * What turns a tracer request into a recording tracer, once registered as the global one.
 */
export type OpenTelemetryTracerProvider = {
    /**
     * Makes this the provider the api hands out tracers from.
     */
    register: () => void,
    /**
     * Sends everything still held, without shutting down.
     */
    forceFlush: () => Promise<void>,
    /**
     * Sends everything still held and stops.
     */
    shutdown: () => Promise<void>
};

/**
 * The part of `@opentelemetry/sdk-trace-node` the framework uses.
 */
export type OpenTelemetryNodeSdk = {
    /**
     * The provider that records spans in a node process.
     */
    NodeTracerProvider: new (config: OpenTelemetryTracerProviderConfig) => OpenTelemetryTracerProvider,
    /**
     * Gathers finished spans and exports them in batches rather than one at a time.
     */
    BatchSpanProcessor: new (exporter: OpenTelemetrySpanExporter) => OpenTelemetrySpanProcessor
};

/**
 * What the OTLP exporter is built with.
 */
export type OpenTelemetryOtlpExporterConfig = {
    /**
     * The collector endpoint to send to.
     */
    url: string,
    /**
     * Headers to put on each request, which is where a hosted collector's api key goes.
     */
    headers?: Record<string, string>,
    /**
     * How long one export may take before it is given up on.
     */
    timeoutMillis?: number,
    /**
     * How many exports may be in flight at once.
     */
    concurrencyLimit?: number
};

/**
 * The part of `@opentelemetry/exporter-trace-otlp-http` the framework uses.
 */
export type OpenTelemetryOtlpExporter = {
    /**
     * Sends spans over OTLP to the endpoint it is built with.
     */
    OTLPTraceExporter: new (config: OpenTelemetryOtlpExporterConfig) => OpenTelemetrySpanExporter
};