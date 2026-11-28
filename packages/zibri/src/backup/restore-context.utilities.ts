import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Set while a restore writes, in the work of the restore alone.
 */
const restoring: AsyncLocalStorage<true> = new AsyncLocalStorage();

/**
 * Tells the writes of a restore of a backup from every other write, such as for a write observer that leaves the rows
 * a restore brings back as they were stored.
 */
export abstract class RestoreContextUtilities {
    /**
     * Runs the work of a restore, whose writes `isRestoring` tells apart.
     * @param work - The work.
     * @returns What the work answers.
     */
    static async run<T>(work: () => Promise<T>): Promise<T> {
        return await restoring.run(true, work);
    }

    /**
     * Whether the code running is the work of a restore, such as one of its writes.
     * @returns True while a restore runs it.
     */
    static isRestoring(): boolean {
        return restoring.getStore() === true;
    }
}
