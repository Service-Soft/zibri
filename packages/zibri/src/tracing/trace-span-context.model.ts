/**
 * Identifies one span, and the trace it belongs to.
 *
 * The sixteen bytes of a trace id and the eight of a span id, written as lowercase hex - the shape
 * the `traceparent` header carries, so that a context taken off an incoming request and one started
 * here are the same kind of thing.
 */
export type TraceSpanContext = {
    /**
     * The trace every span of one distributed operation shares, as 32 hex characters.
     *
     * The value to search a log backend by: every line written while handling one request carries
     * it, in this application and in every other one the request reached.
     */
    traceId: string,
    /**
     * This span, as 16 hex characters. Unique within the trace.
     */
    spanId: string,
    /**
     * Whether the trace is being recorded.
     *
     * Decided by whoever started the trace and carried unchanged from there on, so that every
     * service handling one request agrees about it. A trace half of whose services recorded it is
     * worth less than one nobody recorded, because the gap looks like a service that was never
     * called.
     */
    sampled: boolean,
    /**
     * Vendor state that travels with the trace, as the `tracestate` header spells it.
     *
     * Passed on untouched. It belongs to whichever system started the trace, and this one has
     * nothing to add to it.
     */
    traceState?: string
};