import { type TraceSpanAttributes } from './trace-span-attributes.model.ts';
import { TraceSpanKind } from './trace-span-kind.enum.ts';
import { TraceSpanStatus } from './trace-span-status.enum.ts';
import { Property } from '../entity/decorators/property.decorator.ts';

/**
 * One finished span, as something reading them back sees it.
 *
 * A record rather than the span itself: a span is a thing being written to while the work runs, and
 * what is kept afterwards is what it turned out to be.
 *
 * Declared the way a response body is declared, so that an application which wants to show what it
 * has been doing can answer with these directly rather than translating them first.
 */
export class TraceSpanRecord {
    /**
     * The trace the span belongs to.
     */
    @Property.string()
    traceId!: string;
    /**
     * The span itself.
     */
    @Property.string()
    spanId!: string;
    /**
     * The span this one ran inside. Absent for the root of a trace.
     */
    @Property.string({ required: false })
    parentSpanId?: string | null;
    /**
     * What the work is called, as it was named when it ended.
     */
    @Property.string()
    name!: string;
    /**
     * What kind of work it covers.
     */
    @Property.string({ enum: TraceSpanKind })
    kind!: TraceSpanKind;
    /**
     * When the work started.
     */
    @Property.date()
    startedAt!: Date;
    /**
     * How long it took, in milliseconds and fractions of one.
     */
    @Property.number()
    durationMs!: number;
    /**
     * How it ended.
     */
    @Property.string({ enum: TraceSpanStatus })
    status!: TraceSpanStatus;
    /**
     * Why it ended that way, when anything was said.
     */
    @Property.string({ required: false })
    statusMessage?: string | null;
    /**
     * What was recorded on it besides its name and duration.
     */
    @Property.unknown()
    attributes!: TraceSpanAttributes;
}