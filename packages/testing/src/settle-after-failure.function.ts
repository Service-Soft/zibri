/**
 * Waits for a clean up that runs because something already failed, and reports what fails of it
 * instead of throwing it.
 *
 * The error to throw is the one that made the clean up necessary. A clean up failing as well - a
 * container docker is still busy removing, a store that is gone - would otherwise replace it, and the
 * suite would fail with something about docker instead of what stopped it.
 * @param what - What the clean up does, for the warning.
 * @param steps - The clean up, already started.
 */
export async function settleAfterFailure(what: string, steps: Promise<unknown>[]): Promise<void> {
    for (const result of await Promise.allSettled(steps)) {
        if (result.status === 'rejected') {
            const reason: string = result.reason instanceof Error ? result.reason.message : String(result.reason);
            // to the console rather than the application's logger: a clean up after a failed start
            // runs after that application was shut down, and its logger needs the container it took
            // with it
            // eslint-disable-next-line no-console
            console.warn(`Could not ${what} while cleaning up after a failed start: ${reason}`);
        }
    }
}