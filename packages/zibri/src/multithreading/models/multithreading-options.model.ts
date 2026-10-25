import { type ResourceLimits } from 'node:worker_threads';

/**
 * Options for handling multithreading.
 */
export type MultithreadingOptions = {
    /**
     * The number of threads that can be used.
     * Please notice that there is also **maxPriorityThreads** for the number of threads that should be reserved for priority jobs.
     * Both these values added up can be at most `os.availableParallelism()`.
     * @default os.availableParallelism() - Number(process.env.UV_THREADPOOL_SIZE ?? '4') - 1 (the -1 is reserved for a priority thread)
     */
    maxThreads: number,
    /**
     * The number of threads that can be used by priority jobs.
     * Please notice that there is also **maxThreads** for the number of threads that can be used by normal and priority jobs.
     * Both these values added up can be at most `os.availableParallelism()`.
     * @default 1
     */
    maxPriorityThreads: number,
    /**
     * The default timeout for a thread job.
     * @default 1 hour.
     */
    defaultTimeoutMs: number,
    /**
     * The default timeout for a priority thread job.
     * @default 5 minutes.
     */
    defaultTimeoutPriorityMs: number,
    /**
     * How long the claim on a running job lives before another instance may take that job over.
     *
     * Not a limit on how long a job may run: the claim is renewed underneath for as long as the work
     * does. It only decides how long the rest of the deployment waits before deciding that whoever
     * had the job has stopped existing - so a shorter value takes work back sooner, and a longer one
     * is more forgiving of an instance that stops answering for a while without being gone.
     * @default 30 seconds.
     */
    jobClaimInMs: number,
    /**
     * How many times a job may be started before it is failed instead of taken over again.
     *
     * A job's first start counts, and so does every takeover after it: the job of an instance that
     * stopped existing, or of a worker that was killed for its memory. A job that takes its host down
     * is otherwise taken over by the next instance, which goes down the same way, and so on through
     * the whole deployment one claim at a time. At this many starts it ends `FAILED` with a
     * `ThreadJobAttemptsExhaustedError` instead. `requeueThreadJob` starts the count over.
     * @default 3
     */
    maxAttempts: number,
    /**
     * The memory a worker thread may take, handed to node's `Worker` as its `resourceLimits`.
     *
     * A worker that goes past `maxOldGenerationSizeMb` is ended for it, and its job is `FAILED`
     * with the out of memory error, where a worker without the limit takes the whole process down
     * with it once the container's limit is hit - and the job is then taken over by the next
     * instance. An empty object leaves node's own limits in place.
     * @default `{ maxOldGenerationSizeMb }` with an even share of the memory the process may use, split between the workers and the main thread.
     */
    workerResourceLimits: ResourceLimits,
    /**
     * Whether a worker file may be TypeScript.
     *
     * Compiling one as it is loaded needs the optional peer dependency **ts-node**, so this is also
     * the declaration that it has to be installed: startup fails when this is true and it is not
     * there, rather than the first job to name a `.ts` file failing whenever that happens to be.
     *
     * Set it to false for a deployment that ships compiled worker files. Nothing then loads a
     * TypeScript compiler, a `.ts` file is refused the moment it is queued, and neither **ts-node**
     * nor the TypeScript compiler behind it has to be installed at all.
     * @default true
     */
    enableTsWorkerFiles: boolean
};