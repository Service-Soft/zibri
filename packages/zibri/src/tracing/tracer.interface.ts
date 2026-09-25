import { TraceSpanAttributes } from './trace-span-attributes.model';
import { TraceSpanContext } from './trace-span-context.model';
import { TraceSpanKind } from './trace-span-kind.enum';
import { TraceSpanInterface } from './trace-span.interface';

/**
 * Everything a tracer needs to be told to start a span.
 *
 * Nothing here is optional except the attributes, because this is the inside of the seam rather than
 * the surface anybody calls: `TracingUtilities` is what decides the parent from what is running and
 * what a caller left unsaid, and hands the answer over already made.
 */
export type StartSpanOptions = {
    /**
     * What kind of work the span covers.
     */
    kind: TraceSpanKind,
    /**
     * The span this one hangs under.
     *
     * Undefined starts a new trace, which is what background work does - a cron tick is nobody's
     * child.
     */
    parent: TraceSpanContext | undefined,
    /**
     * What is already known about the work when it starts.
     */
    attributes?: TraceSpanAttributes
};

/**
 * Turns work into spans somebody can look at.
 *
 * Register one under `ZIBRI_DI_TOKENS.TRACER` and the framework traces itself: every request it
 * answers, every request it makes, every read and write of a data source or a cache, and every piece
 * of background work it runs. Register nothing and it does not, at the cost of one comparison per
 * operation.
 *
 * `OpenTelemetryTracer` is the implementation that ships with the framework. Writing another one is
 * four methods, which is the point of the seam being this narrow.
 */
export interface TracerInterface {
    /**
     * Starts a span.
     *
     * Never throws: tracing is a thing that watches work, and a watcher that can fail the work is
     * worse than no watcher. An implementation that cannot start a span returns one that records
     * nothing.
     * @param name - What the work is, as something low cardinality enough to group by. A route
     * template rather than a url, an operation rather than the row it touched.
     * @param options - The kind of work, what it hangs under, and what is known about it already.
     * @returns The span, to be ended by whoever asked for it.
     */
    startSpan: (name: string, options: StartSpanOptions) => TraceSpanInterface
}