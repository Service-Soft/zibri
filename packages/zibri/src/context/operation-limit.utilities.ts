import { AlsUtilities } from './als.utilities.ts';
import { OperationLimit } from './operation-limit.model.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';

/**
 * A limit that has been started, and the way to stop its clock.
 */
export type OpenedOperationLimit = {
    /**
     * The limit, to run the work under.
     */
    limit: OperationLimit,
    /**
     * Stops the clock, once the work is done.
     */
    close: () => void
};

/**
 * Runs work under a limit on how long it may take.
 */
export abstract class OperationLimitUtilities {

    /**
     * Runs the given function under a limit of the given length.
     *
     * Each statement of the work may take that long, and the work as a whole as well: once it has run
     * out of time, the limit's signal fires and a store refuses whatever the work asks of it next. The
     * signal also fires with the request the work belongs to and with any limit it already runs under,
     * so an inner limit never outlasts an outer one.
     * @param timeoutInMs - How long the work may take, in milliseconds. 0 for no limit, which still
     * lifts the data source's own statement timeout.
     * @param subject - What the work is, for the error it fails with.
     * @param fn - The work.
     * @returns Whatever the work returned.
     * @throws When the timeout is not a whole number of at least 0.
     */
    static async runWithin<T>(timeoutInMs: number, subject: string, fn: () => Promise<T>): Promise<T> {
        const opened: OpenedOperationLimit = this.openLimit(timeoutInMs, subject);
        try {
            return await AlsUtilities.runWithOperationLimit(opened.limit, fn);
        }
        finally {
            opened.close();
        }
    }

    /**
     * Starts the clock of a limit of the given length, for work that cannot be run as one function -
     * a stream, which is pulled from in pieces.
     * @param timeoutInMs - How long the work may take, in milliseconds. 0 for no limit.
     * @param subject - What the work is, for the error it fails with.
     * @returns The limit, and the way to stop its clock once the work is done.
     * @throws When the timeout is not a whole number of at least 0.
     */
    static openLimit(timeoutInMs: number, subject: string): OpenedOperationLimit {
        if (!Number.isInteger(timeoutInMs) || timeoutInMs < 0) {
            throw new InternalError(`${subject}: a timeout has to be a whole number of milliseconds of at least 0, not ${timeoutInMs}.`);
        }

        const outer: AbortSignal | undefined = AlsUtilities.findCurrentSignal();
        if (timeoutInMs === 0) {
            return { limit: { timeoutInMs, signal: outer }, close: () => undefined };
        }

        const controller: AbortController = new AbortController();
        const timer: NodeJS.Timeout = setTimeout(
            () => controller.abort(new InternalError(`${subject} took longer than the ${timeoutInMs}ms it was given.`)),
            timeoutInMs
        );
        // a limit is for the work, never a reason to keep the process alive
        timer.unref();
        return {
            limit: {
                timeoutInMs,
                signal: outer == undefined ? controller.signal : AbortSignal.any([controller.signal, outer])
            },
            close: () => clearTimeout(timer)
        };
    }
}