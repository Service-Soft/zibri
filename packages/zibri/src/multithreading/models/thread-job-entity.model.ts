import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from './base-thread-job-worker-data.model.ts';
import { ThreadJobStatus } from './thread-job-status.enum.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { Entity } from '../../entity/decorators/entity.decorator.ts';
import { Property } from '../../entity/decorators/property.decorator.ts';
import { LoggedError } from '../../logging/logged-error.model.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { type Percentage } from '../../types/percentage.type.ts';
import { ThreadJob } from '../services/thread-job.ts';

// eslint-disable-next-line no-unused-vars
const omitValues: (keyof ThreadJob<BaseThreadJobWorkerData, unknown>)[] = [
    'onCancel',
    'onComplete',
    'onError',
    'onMessage',
    'completedSubject'
];

// eslint-disable-next-line jsdoc-js/require-jsdoc
type OmitValues = typeof omitValues[number];

/**
 * Contains information about an invoice.
 */
@Entity({ allowOrphan: true })
export class ThreadJobEntity<WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, ResultType>
    extends BaseEntity
    implements OmitStrict<ThreadJob<WorkerData, ResultType>, OmitValues> {

    /**
     * The tenant the job was queued in, or null for one queued outside every tenant.
     */
    @Property.string({ format: 'uuid', required: false })
    tenantId?: string | null;

    /**
     * The trace the job was queued in, as a `traceparent` header writes it, or null for one queued
     * outside any trace. The run of the job is recorded under it, wherever and whenever it runs.
     */
    @Property.string({ required: false })
    traceparent?: string | null;

    /**
     * The vendor state of that trace, as a `tracestate` header writes it.
     */
    @Property.string({ required: false })
    tracestate?: string | null;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.number({ format: 'integer' })
    queuedAtMs!: number;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.number({ format: 'integer', required: false })
    startedAtMs?: number | null;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.number({ format: 'integer', required: false })
    stoppedAtMs?: number | null;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.string({ enum: ThreadJobStatus })
    status!: ThreadJobStatus;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.number({ format: 'integer', required: false })
    threadId?: number | null;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.number({ format: 'integer' })
    progress!: Percentage;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.boolean()
    priority!: boolean;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.number()
    timeout!: number;

    /**
     * What the job failed with.
     *
     * A `LoggedError` rather than an `Error`: an `Error` keeps its message, stack and cause on
     * non-enumerable fields, so a column storing one keeps `{}` - the row would say a job failed
     * and nothing whatever about what.
     */
    @Property.unknown({ required: false })
    error?: LoggedError | null;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.unknown()
    workerData!: WorkerData;

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    @Property.unknown({ required: false })
    result?: ResultType | null;
}