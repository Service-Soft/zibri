import { Worker } from 'node:worker_threads';

import { BehaviorSubject } from 'rxjs';

/**
 * A worker for handling thread job.
 * Consists of the actual worker, whether or not it is a priority worker. And the information of whether the worker is still initializing.
 */
export class ThreadJobWorker {
    /**
     * A persisted thread id.
     * This is needed because the internal worker sets its threadId to -1 when it crashes
     * => There is no way to check which thread job was affected by the crash.
     */
    readonly threadId: number;
    /**
     * The actual worker.
     */
    readonly worker: Worker;
    /**
     * Whether or not this is a priority worker.
     */
    readonly priority: boolean;
    /**
     * The timeout object after which this thread should be terminated.
     */
    timeout?: NodeJS.Timeout;
    /**
     * Subject that contains whether or not the worker is still initializing.
     */
    readonly isInitializingSubject: BehaviorSubject<boolean> = new BehaviorSubject(true);

    constructor(worker: Worker, priority: boolean, threadId: number) {
        this.worker = worker;
        this.priority = priority;
        this.threadId = threadId;
    }
}