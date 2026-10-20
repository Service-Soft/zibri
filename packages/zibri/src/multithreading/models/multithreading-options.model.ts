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
     * Whether a worker file may be TypeScript.
     *
     * Compiling one as it is loaded needs the optional peer dependency **oxc-transform**, so this is
     * also the declaration that it has to be installed: startup fails when this is true and it is not
     * there, rather than the first job to name a `.ts` file failing whenever that happens to be.
     *
     * Set it to false for a deployment that ships compiled worker files. Nothing then loads a
     * TypeScript compiler, a `.ts` file is refused the moment it is queued, and **oxc-transform**
     * does not have to be installed at all.
     * @default true
     */
    enableTsWorkerFiles: boolean
};