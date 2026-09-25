import { TraceSpanAttributes } from './trace-span-attributes.model';
import { TraceSpanContext } from './trace-span-context.model';
import { TraceSpanKind } from './trace-span-kind.enum';
import { TraceSpanStatus } from './trace-span-status.enum';
import { TraceSpanInterface } from './trace-span.interface';
import { TracerInterface } from './tracer.interface';
import { AlsUtilities } from '../context/als.utilities';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';

/**
 * What a caller says about the work it is about to do.
 *
 * Everything is optional: the common case is a name and nothing else, and what a span hangs under is
 * read off what is already running rather than passed down.
 */
export type TraceOptions = {
    /**
     * What kind of work the span covers. Internal work when nothing says otherwise.
     */
    kind?: TraceSpanKind,
    /**
     * What is already known about the work when it starts.
     */
    attributes?: TraceSpanAttributes,
    /**
     * Starts a new trace rather than hanging under whatever is running.
     *
     * What background work does. A cron tick that fired while a request happened to be in flight is
     * not part of that request, and a trace that claimed otherwise would make one request look
     * responsible for everything the schedule did.
     */
    root?: boolean,
    /**
     * What the span hangs under, for work that arrived carrying a trace of its own.
     *
     * Only a request has one: it is read off the headers before anything here is running, so there
     * is nothing for the span to be found under. Everything else leaves this alone.
     */
    parent?: TraceSpanContext
};

/**
 * Records what the application does as spans.
 *
 * The surface the framework traces itself through, and the one to use for tracing your own work.
 *
 * ```ts
 * await TracingUtilities.trace('rebuild search index', {}, async () => {
 *     await this.indexService.rebuild();
 * });
 * ```
 */
export abstract class TracingUtilities {
    /**
     * Runs the given function as one span.
     *
     * The span ends when the function does, whichever way it ends: an error is recorded on it and
     * rethrown, so tracing never changes what the work does or what a caller sees.
     * @param name - What the work is, as something low cardinality enough to group by. A route
     * template rather than a url, an operation rather than the row it touched.
     * @param options - What is known about the work.
     * @param fn - The work. Given the span, so that what is learned while it runs can be recorded.
     * @returns Whatever the function returned.
     */
    static async trace<T>(name: string, options: TraceOptions, fn: (span: TraceSpanInterface) => Promise<T>): Promise<T> {
        const span: TraceSpanInterface = this.startSpan(name, options);
        return await this.runWithSpan(span, async () => {
            try {
                const result: T = await fn(span);
                span.end();
                return result;
            }
            catch (error) {
                span.recordError(error);
                span.end(TraceSpanStatus.ERROR);
                throw error;
            }
        });
    }

    /**
     * Starts a span that somebody else will end.
     *
     * For work whose end is not the end of a function - a request, which finishes when its response
     * closes. Everything else should use {@link trace}, which cannot forget to end one.
     * @param name - What the work is.
     * @param options - What is known about the work.
     * @returns The span.
     */
    static startSpan(name: string, options: TraceOptions = {}): TraceSpanInterface {
        const tracer: TracerInterface = inject(ZIBRI_DI_TOKENS.TRACER);
        return tracer.startSpan(name, {
            kind: options.kind ?? TraceSpanKind.INTERNAL,
            parent: options.root === true ? undefined : options.parent ?? this.getCurrentTraceContext(),
            attributes: options.attributes
        });
    }

    /**
     * Runs the given function with the span recorded as the one everything inside it belongs to.
     *
     * Also establishes the trace context, so that an outgoing request made inside names this span as
     * what it answers to.
     * @param span - The span.
     * @param fn - The function to run.
     * @returns The result of the function.
     */
    static runWithSpan<T>(span: TraceSpanInterface, fn: () => T): T {
        return AlsUtilities.runWithTraceContext(span.context, () => AlsUtilities.runWithSpan(span, fn));
    }

    /**
     * The span being recorded right now.
     *
     * Somewhere to hang what is learned while work runs - which user it turned out to be for, how
     * many rows it touched - without threading a span through the code that learns it.
     * @returns The span, or undefined when none was started here.
     */
    static getCurrentSpan(): TraceSpanInterface | undefined {
        return AlsUtilities.getCurrentSpan();
    }

    /**
     * The trace the work running here belongs to.
     *
     * What log lines report and what outgoing requests carry. Present whenever a request is being
     * handled, and whenever background work is running.
     * @returns The context, or undefined outside any traced work.
     */
    static getCurrentTraceContext(): TraceSpanContext | undefined {
        return AlsUtilities.getCurrentSpan()?.context ?? AlsUtilities.getCurrentTraceContext();
    }
}