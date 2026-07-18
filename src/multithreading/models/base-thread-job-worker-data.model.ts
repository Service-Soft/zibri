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
 * **IMPORTANT**: This uses "eval" in the thread worker, so make sure that the data passed is not malicious.
 */
export type BaseFunctionThreadJobWorkerData<I> = {
    /**
     * A stringified function to call in the worker.
     */
    func: string,
    /**
     * The input parameter of the function.
     */
    input: I
};