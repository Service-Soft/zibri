import { BehaviorSubject } from 'rxjs';

import { Percentage } from '../../types/percentage.type';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobData, ThreadJobDataFunctions } from '../models/thread-job-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

/**
 * A thread job.
 */
export class ThreadJob<
    WorkerData extends BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
    ResultType
> implements ThreadJobData<WorkerData> {
    /**
     * Timestamp of when the job was queued in milliseconds.
     */
    readonly queuedAtMs: number;
    /**
     * The type of the job. (whether it's a real job with db persistence or just a simple function call).
     */
    readonly type: 'job' | 'function';
    /**
     * Timestamp of when the job was started in milliseconds.
     */
    startedAtMs?: number | null;
    /**
     * Timestamp of when the job was stopped in milliseconds.
     */
    stoppedAtMs?: number | null;
    /**
     * A unique identifier of the job.
     * **This differs from the threadId, which is created by the os and set when the thread actually starts.**.
     */
    readonly id: string;
    /**
     * The status of the job.
     */
    status: ThreadJobStatus;
    /**
     * The id of the thread that the job is running in.
     * Set by the os.
     */
    threadId?: number | null;
    /**
     * The progress of the job in a percentage.
     */
    progress: Percentage;
    /**
     * The error that the job failed with.
     */
    error?: Error | null;
    /**
     * The result that the job finished with.
     */
    result?: ResultType;
    /**
     * A subject that contains whether or not the job was completed.
     */
    readonly completedSubject: BehaviorSubject<boolean> = new BehaviorSubject(false);
    // eslint-disable-next-line jsdoc/require-jsdoc
    timeout: number;
    // eslint-disable-next-line jsdoc/require-jsdoc
    priority: boolean;
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly workerData: WorkerData;
    // eslint-disable-next-line jsdoc/require-jsdoc
    onMessage?: (message: unknown) => void;
    // eslint-disable-next-line jsdoc/require-jsdoc
    onComplete?: () => void;
    // eslint-disable-next-line jsdoc/require-jsdoc
    onError?: (error: Error) => void;
    // eslint-disable-next-line jsdoc/require-jsdoc
    onCancel?: () => void;

    constructor(
        entity: ThreadJobEntity<WorkerData, ResultType>,
        type: 'job' | 'function',
        functions?: ThreadJobDataFunctions
    ) {
        this.type = type;
        this.queuedAtMs = entity.queuedAtMs;
        this.id = entity.id;
        this.status = entity.status;
        this.workerData = entity.workerData;
        this.onMessage = functions?.onMessage;
        this.onError = functions?.onError;
        this.onComplete = functions?.onComplete;
        this.onCancel = functions?.onCancel;
        this.progress = entity.progress;
        this.priority = entity.priority;
        this.timeout = entity.timeout;
        this.error = entity.error;
        this.progress = entity.progress;
        this.startedAtMs = entity.startedAtMs;
        this.stoppedAtMs = entity.stoppedAtMs;
        this.threadId = entity.threadId;

    }
}