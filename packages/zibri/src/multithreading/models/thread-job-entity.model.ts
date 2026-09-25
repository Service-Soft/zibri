import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from './base-thread-job-worker-data.model';
import { ThreadJobStatus } from './thread-job-status.enum';
import { BaseEntity } from '../../entity/base-entity.model';
import { Entity } from '../../entity/decorators/entity.decorator';
import { Property } from '../../entity/decorators/property.decorator';
import { LoggedError } from '../../logging/logged-error.model';
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
 * Contains information about an invoice.
 */
@Entity()
export class ThreadJobEntity<WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, ResultType>
    extends BaseEntity
    implements OmitStrict<ThreadJob<WorkerData, ResultType>, OmitValues> {

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number()
    queuedAtMs!: number;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number({ required: false })
    startedAtMs?: number | null;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number({ required: false })
    stoppedAtMs?: number | null;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.string({ enum: ThreadJobStatus })
    status!: ThreadJobStatus;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number({ required: false })
    threadId?: number | null;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.number()
    progress!: Percentage;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.boolean()
    priority!: boolean;

    // eslint-disable-next-line jsdoc/require-jsdoc
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.unknown()
    workerData!: WorkerData;

    // eslint-disable-next-line jsdoc/require-jsdoc
    @Property.unknown({ required: false })
    result?: ResultType | null;
}