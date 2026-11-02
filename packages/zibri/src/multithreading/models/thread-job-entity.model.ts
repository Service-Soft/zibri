import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from './base-thread-job-worker-data.model';
import { ThreadJobCheckpoint } from './thread-job-checkpoint.model';
import { ThreadJobStatus } from './thread-job-status.enum';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { QueuedWorkEntity } from '../../queue/queued-work-entity.model';
import { OmitStrict } from '../../types/omit-strict.type';
import { type Percentage } from '../../types/percentage.type';
import { ThreadJob } from '../services/thread-job';

// eslint-disable-next-line unusedImports/no-unused-vars
const omitValues: (keyof ThreadJob<BaseThreadJobWorkerData, unknown>)[] = [
    'onCancel',
    'onComplete',
    'onError',
    'onMessage',
    'completedSubject'
];

// eslint-disable-next-line jsdoc/require-jsdoc
type OmitValues = typeof omitValues[number];

/**
 * A thread job as the queue keeps it: what it runs, where it stands, and how it ended. Its `attempts`
 * count how many times a worker was handed it, its first start and every takeover since, and `error`
 * holds what it failed with. A job that failed is not tried again, so `nextAttemptAt` stays empty.
 */
// indexed as the pool reads it: the takeable rows of a priority class, oldest first.
//
// On the columns every queue shares, but not on its run: a job counts its starts rather than its
// outcomes, holds its claim for the whole run, and is not retried when it throws
@Entity({ allowOrphan: true, indexes: [['status', 'priority', 'queuedAtMs']] })
export class ThreadJobEntity<WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, ResultType>
    extends QueuedWorkEntity
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number({ format: 'integer' })
    queuedAtMs!: number;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number({ format: 'integer', required: false })
    startedAtMs?: number | null;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number({ format: 'integer', required: false })
    stoppedAtMs?: number | null;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ enum: ThreadJobStatus })
    status!: ThreadJobStatus;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number({ format: 'integer', required: false })
    threadId?: number | null;

    /**
     * The instance running it, as `ZIBRI_DI_TOKENS.INSTANCE_ID` names it. Diagnostic only - nothing
     * branches on it.
     */
    @Property.string({ required: false })
    instanceId?: string | null;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number({ format: 'integer' })
    progress!: Percentage;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.boolean()
    priority!: boolean;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number()
    timeoutInMs!: number;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.unknown()
    workerData!: WorkerData;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.unknown({ required: false })
    result?: ResultType | null;

    /**
     * The last checkpoint the job stored with `reportCheckpoint`, which a run started after it resumes
     * from. Null for a job that stored none.
     */
    @Property.unknown({ required: false })
    checkpoint?: ThreadJobCheckpoint<unknown> | null;
}