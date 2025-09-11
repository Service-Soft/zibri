/**
 * Options for handling multithreading.
 */
export type MultithreadingOptions = {
    /**
     * The number of threads that can be used.
     * Please notice that there is also **maxPriorityThreads** for the number of threads that should be reserved for priority jobs.
     * Both these values added up need to be smaller than your current machines available threads.
     * @default os.availableParallelism() - Number(process.env.UV_THREADPOOL_SIZE ?? '4') - 1 (the -1 is reserved for a priority thread)
     */
    maxThreads: number,
    /**
     * The number of threads that can be used by priority jobs.
     * Please notice that there is also **maxThreads** for the number of threads that can be used by normal and priority jobs.
     * Both these values added up need to be smaller than your current machines available threads.
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
    defaultTimeoutPriorityMs: number
};