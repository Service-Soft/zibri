import { TraceSpanAttributeName, TraceSpanAttributeValue, TraceSpanAttributes } from './trace-span-attributes.model.ts';
import { TraceSpanContext } from './trace-span-context.model.ts';
import { TraceSpanStatus } from './trace-span-status.enum.ts';

/**
 * One timed piece of work inside a trace.
 *
 * Handed out by a tracer and finished by whoever asked for it. Everything on it is a statement about
 * work that is still running, which is why nothing here returns a value: a span is written to, not
 * read from.
 */
export interface TraceSpanInterface {
    /**
     * What identifies this span and the trace it belongs to.
     *
     * Available before the span ends, because it is what an outgoing request has to carry.
     */
    readonly context: TraceSpanContext,
    /**
     * Renames the span.
     *
     * For work that only learns what it is partway through: a request is a span before a route has
     * been matched, and what it should be called is the route.
     */
    updateName: (name: string) => void,
    /**
     * Records one thing about the work.
     *
     * An undefined value is ignored rather than written, so a caller can offer what it might know
     * without checking first.
     */
    recordAttribute: (name: TraceSpanAttributeName, value: TraceSpanAttributeValue | undefined) => void,
    /**
     * Records several things about the work at once.
     */
    recordAttributes: (attributes: TraceSpanAttributes) => void,
    /**
     * Records that the work hit an error.
     *
     * Separate from ending the span as a failure, because the two are not the same thing: work that
     * recovers from an error still succeeded, and work that failed did not always do so with an
     * error in hand.
     */
    recordError: (error: unknown) => void,
    /**
     * Finishes the span, which is when its duration is decided.
     *
     * Calling it twice is ignored rather than refused - a span ended in a `finally` and again on the
     * way out of a branch is a mistake that should not take down the work being traced.
     * @param status - How it ended. Left unset when nothing was decided.
     */
    end: (status?: TraceSpanStatus) => void
}