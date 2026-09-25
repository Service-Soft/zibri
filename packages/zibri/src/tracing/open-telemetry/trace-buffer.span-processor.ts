import { OpenTelemetryApi, OpenTelemetryReadableSpan, OpenTelemetrySpanProcessor } from './open-telemetry-api.model';
import { OpenTelemetryUtilities } from './open-telemetry.utilities';
import { TraceBufferInterface } from '../trace-buffer.interface';

/**
 * Puts every span the application finishes into the buffer it keeps.
 *
 * A processor rather than an exporter, because nothing is being sent: an exporter is asked for
 * batches and told when to flush, and neither means anything for spans that never leave the process.
 */
export class TraceBufferSpanProcessor implements OpenTelemetrySpanProcessor {
    constructor(
        private readonly buffer: TraceBufferInterface,
        private readonly api: OpenTelemetryApi
    ) {}

    /**
     * Does nothing, deliberately.
     *
     * A span is kept for what it turned out to be - its name, its attributes and how long it took -
     * and none of that is known yet when one starts.
     */
    onStart(): void {
        // nothing to keep until the span has finished
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onEnd(span: OpenTelemetryReadableSpan): void {
        this.buffer.record({
            traceId: span.spanContext().traceId,
            spanId: span.spanContext().spanId,
            parentSpanId: span.parentSpanContext?.spanId,
            name: span.name,
            kind: OpenTelemetryUtilities.findKind(span.kind, this.api),
            startedAt: new Date(OpenTelemetryUtilities.resolveMilliseconds(span.startTime)),
            durationMs: OpenTelemetryUtilities.resolveMilliseconds(span.duration),
            status: OpenTelemetryUtilities.findStatus(span.status.code, this.api),
            statusMessage: span.status.message,
            attributes: { ...span.attributes }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async forceFlush(): Promise<void> {
        // nothing is held on the way anywhere, so there is nothing a flush could do
        await Promise.resolve();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async shutdown(): Promise<void> {
        // the buffer is this process's memory and goes when it does
        await Promise.resolve();
    }
}