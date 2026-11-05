import { OpenTelemetryApi, OpenTelemetrySpan, OpenTelemetrySpanContext } from './open-telemetry-api.model';
import { OpenTelemetryUtilities } from './open-telemetry.utilities';
import { TraceContextUtilities } from '../trace-context.utilities';
import { TraceSpanAttributeName, TraceSpanAttributeValue, TraceSpanAttributes } from '../trace-span-attributes.model';
import { TraceSpanContext } from '../trace-span-context.model';
import { TraceSpanStatus } from '../trace-span-status.enum';
import { TraceSpanInterface } from '../trace-span.interface';

const sampledFlag: number = 0b0000_0001;

const allZeroes: RegExp = /^0+$/;

/**
 * A span recorded through whichever OpenTelemetry SDK the application set up.
 */
export class OpenTelemetrySpanAdapter implements TraceSpanInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly context: TraceSpanContext;

    /**
     * Whether the span has already been finished.
     *
     * A span ended twice is a mistake in the code being traced, and letting it reach the sdk turns
     * that mistake into a warning from somebody else's package on every request.
     */
    private ended: boolean = false;

    constructor(
        private readonly span: OpenTelemetrySpan,
        private readonly api: OpenTelemetryApi,
        parent: TraceSpanContext | undefined
    ) {
        this.context = this.resolveContext(span.spanContext(), parent);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    updateName(name: string): void {
        this.span.updateName(name);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    recordAttribute(name: TraceSpanAttributeName, value: TraceSpanAttributeValue | undefined): void {
        this.recordAttributes({ [name]: value });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    recordAttributes(attributes: TraceSpanAttributes): void {
        this.span.setAttributes(attributes);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    recordError(error: unknown): void {
        // the type of the error as its own attribute, because that is the one part of an error a
        // backend can group by - a message carries ids and a stack carries paths, and neither
        // aggregates
        this.recordAttribute('error.type', error instanceof Error ? error.name : typeof error);
        this.span.recordException(error instanceof Error ? error : String(error));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    end(status: TraceSpanStatus = TraceSpanStatus.UNSET): void {
        if (this.ended) {
            return;
        }
        this.ended = true;
        this.span.setStatus({ code: OpenTelemetryUtilities.resolveApiStatus(status, this.api) });
        this.span.end();
    }

    /**
     * Reads what the sdk says about the span into the shape the framework states contexts in.
     *
     * An application with nothing recording - no SDK configured, or a trace this one decided not to
     * sample - gets a context back that does not identify a span: all zeroes when there was no
     * parent to continue, and the parent's own context unchanged when there was. Both are the api
     * saying "no span was made here", and both are answered the same way.
     *
     * The work still needs an identity even so. Its trace id is what every log line of it reports
     * and what the next service continues, and its span id is what tells the lines one request wrote
     * while talking to the database from the ones it wrote while answering. None of that depends on
     * anybody recording spans, so a context the api will not give is made here instead.
     * @param context - What the sdk reports.
     * @param parent - What the span was started under, whose trace it belongs to either way.
     * @returns The context.
     */
    private resolveContext(context: OpenTelemetrySpanContext, parent: TraceSpanContext | undefined): TraceSpanContext {
        if (allZeroes.test(context.traceId) || context.spanId === parent?.spanId) {
            return TraceContextUtilities.resolveSpanContext(parent);
        }
        return {
            traceId: context.traceId,
            spanId: context.spanId,
            sampled: (context.traceFlags & sampledFlag) === sampledFlag,
            traceState: context.traceState?.serialize()
        };
    }
}