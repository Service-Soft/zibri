import { FsPath } from '../../utilities/fs.utilities';

/**
 * The base data for a thread job worker.
 */
export type BaseThreadJobWorkerData = {
    /**
     * The path to the worker file.
     * **This can either be a ts or a js file**.
     */
    filePath: FsPath
};

/**
 * The data to run a function in the thread worker.
 *
 * Only reachable through `run`, which keeps the job in this process. A queued job is written to a
 * row and read back to be requeued, so a function there would have to be stored as source and turned
 * back into code to run a second time - and write access to that table would then be enough to run
 * code in a worker. `queueThreadJob` refuses it for that reason; work that has to survive a restart
 * lives in a file.
 */
export type BaseFunctionThreadJobWorkerData<I> = {
    /**
     * A stringified function to call in the worker.
     *
     * Built back into a function with its arguments and the worker's globals in scope and nothing
     * else, so a variable captured from around it is a `ReferenceError` when it runs. Everything it
     * needs goes through `input`.
     */
    func: string,
    /**
     * The input parameter of the function.
     */
    input: I
};