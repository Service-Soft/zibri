import { ThreadJob } from './thread-job';
import { ThreadJobWorker } from './thread-job-worker';
import { ThreadJobWorkerEvents } from './thread-job-worker-events.model';
import { errorToLoggedError } from '../../logging/error-to-logged-error.function';
import { LoggedError } from '../../logging/logged-error.model';
import { JsonUtilities } from '../../utilities/json.utilities';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobCheckpointAnswer } from '../models/thread-job-checkpoint-answer.model';
import { ThreadJobCheckpoint } from '../models/thread-job-checkpoint.model';
import { ThreadJobMessage } from '../models/thread-job-message.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

/**
 * Handles what the workers of a thread job pool report: their messages, their exit and their errors.
 */
export abstract class ThreadJobWorkerEventUtilities {
    /**
     * Handles a message a worker posted: what it reports of its job, or a message of the job's own.
     * @param events - What the handling does to the pool and its jobs.
     * @param message - The message.
     * @param threadId - The thread it came from.
     */
    static async handleMessage(events: ThreadJobWorkerEvents, message: unknown, threadId: number): Promise<void> {
        events.logger.debug(`got message from worker:\n${JsonUtilities.stringify(message, undefined, 2)}`);

        const job: ThreadJob<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > | undefined = events.findJob(threadId);
        if (!job) {
            if (this.isThreadJobMessage(message) && message.type === 'initialization') {
                this.markInitialized(events, threadId);
            }
            return;
        }

        if (!this.isThreadJobMessage(message)) {
            await events.callBack(job, () => job.onMessage?.(message));
            return;
        }

        switch (message.type) {
            case 'progress': {
                if (message.progress !== 100) {
                    await events.updateJob(job.id, { progress: message.progress });
                    return;
                }
                try {
                    await events.updateJob(job.id, { progress: message.progress });
                    await events.updateJob(
                        job.id,
                        { status: ThreadJobStatus.COMPLETED, threadId: undefined, stoppedAtMs: Date.now() }
                    );
                    await events.callBack(job, () => job.onComplete?.());
                }
                finally {
                    await events.completeJob(job, threadId);
                }
                return;
            }
            case 'checkpoint': {
                await this.storeCheckpoint(events, job, message.checkpointId, message.checkpoint, threadId);
                return;
            }
            case 'completion': {
                try {
                    await events.updateJob(job.id, {
                        status: ThreadJobStatus.COMPLETED,
                        threadId: undefined,
                        stoppedAtMs: Date.now(),
                        progress: 100,
                        result: message.result
                    });
                    await events.callBack(job, () => job.onComplete?.());
                }
                finally {
                    await events.completeJob(job, threadId);
                }
                return;
            }
            case 'status': {
                await events.updateJob(job.id, { status: message.status });
                return;
            }
            case 'error': {
                try {
                    await events.updateJob(
                        job.id,
                        { status: ThreadJobStatus.FAILED, threadId: undefined, stoppedAtMs: Date.now(), error: message.error }
                    );
                    await events.callBack(job, () => job.onError?.(this.toThrownError(message.error)));
                }
                finally {
                    if (message.fatal) {
                        // the worker is ending itself, so it must not go back on the idle list for the
                        // moment it has left - the next job would be posted to a thread already on its
                        // way out. Its exit is what takes it out of the pool and starts a replacement;
                        // the queue moves on with whatever other workers are free.
                        events.settleJob(job);
                        await events.startQueuedJobs();
                    }
                    else {
                        await events.completeJob(job, threadId);
                    }
                }
                return;
            }
            case 'initialization': {
                this.markInitialized(events, threadId);
            }
        }
    }

    /**
     * Handles a worker thread ending, which is not only on shutdown: a worker can be killed for its
     * memory, crash in native code, or be signalled from outside at any point. The job it was running
     * fails when the exit code says it crashed, and is cancelled otherwise.
     * @param events - What the handling does to the pool and its jobs.
     * @param exitCode - The code that the worker exited with.
     * @param threadId - The thread id of the worker.
     */
    static async handleExit(events: ThreadJobWorkerEvents, exitCode: number, threadId: number): Promise<void> {
        // an error the thread job reports arrives as a message, see handleMessage
        const job: ThreadJob<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > | undefined = events.findJob(threadId);
        if (!job) {
            events.replaceDeadWorker(exitCode, threadId);
            return;
        }

        if (exitCode !== 0) {
            try {
                await events.updateJob(job.id, {
                    stoppedAtMs: Date.now(),
                    status: ThreadJobStatus.FAILED,
                    threadId: undefined
                });
            }
            finally {
                await events.completeJob(job, threadId);
            }
            return;
        }

        try {
            await events.updateJob(job.id, {
                stoppedAtMs: Date.now(),
                status: ThreadJobStatus.CANCELLED,
                threadId: undefined
            });
            await events.callBack(job, () => job.onCancel?.());
        }
        finally {
            await events.completeJob(job, threadId);
        }
    }

    /**
     * Handles an error that crashed a worker. The job it was running fails, without its `onError`
     * being called.
     * @param events - What the handling does to the pool and its jobs.
     * @param error - The error that crashed the worker.
     * @param threadId - The threadId of the worker that crashed.
     */
    static async handleError(events: ThreadJobWorkerEvents, error: Error, threadId: number): Promise<void> {
        // this should never happen, as the whole worker crashes and not just the current task, which
        // is why the job's onError is not called: an error the thread job reports arrives as a
        // message, see handleMessage
        const job: ThreadJob<
            BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>,
            unknown
        > | undefined = events.findJob(threadId);
        if (!job) {
            const worker: ThreadJobWorker | undefined = events.findWorker(threadId);
            if (worker) {
                worker.isInitializingSubject.error(error);
            }
            return;
        }

        try {
            await events.updateJob(job.id, {
                stoppedAtMs: Date.now(),
                status: ThreadJobStatus.FAILED,
                error: errorToLoggedError(error),
                threadId: undefined
            });
        }
        finally {
            await events.completeJob(job, threadId);
        }
    }

    /**
     * Turns the error a worker reported back into a real one.
     * @param reported - The stored error.
     * @returns An Error carrying the same name, message and stack.
     */
    static toThrownError(reported: LoggedError): Error {
        // the worker reports a LoggedError, because an Error's own fields are not enumerable and would
        // be lost the moment the message crosses the thread boundary or the row is written. That shape
        // is right for the column and wrong for a caller, who asked for a function to run and expects
        // to catch what the signature promises, so it is rebuilt on the way out
        const error: Error = new Error(reported.paragraphs.join('\n'));
        error.name = reported.name;
        error.stack = reported.stackTrace.join('\n');
        return error;
    }

    /**
     * Stores a checkpoint a worker reported, with its progress, and tells the worker whether it is.
     *
     * Under the condition every write of the run is made under, so a run another instance took over
     * stores nothing over the checkpoint the new run resumes from. The worker waits for the answer,
     * and goes on only once there is something to resume from.
     * @param events - What the handling does to the pool and its jobs.
     * @param job - The job the checkpoint is of.
     * @param checkpointId - Pairs the answer with the report.
     * @param checkpoint - The checkpoint.
     * @param threadId - The thread it came from.
     */
    private static async storeCheckpoint(
        events: ThreadJobWorkerEvents,
        job: ThreadJob<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>,
        checkpointId: string,
        checkpoint: ThreadJobCheckpoint<unknown>,
        threadId: number
    ): Promise<void> {
        const answer: (reply: ThreadJobCheckpointAnswer) => void = reply => events.findWorker(threadId)?.worker.postMessage(reply);
        try {
            if (await events.updateJob(job.id, { checkpoint, progress: checkpoint.progress })) {
                answer({ type: 'checkpointStored', checkpointId });
                return;
            }
            answer({ type: 'checkpointNotStored', checkpointId, reason: `Another run of thread job ${job.id} took it over.` });
        }
        catch (error) {
            // answered all the same, or the worker waits for it until the job times out
            answer({ type: 'checkpointNotStored', checkpointId, reason: error instanceof Error ? error.message : String(error) });
            throw error;
        }
    }

    private static markInitialized(events: ThreadJobWorkerEvents, threadId: number): void {
        events.findWorker(threadId)?.isInitializingSubject.next(false);
    }

    private static isThreadJobMessage(value: unknown): value is ThreadJobMessage {
        return typeof value === 'object' && !!(value as ThreadJobMessage).type;
    }
}