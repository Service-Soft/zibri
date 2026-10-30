/**
 * Listens for the wake ups of one topic, until it is stopped.
 */
export type WakeUpListener = {
    /**
     * Resolves at the next wake up of the topic, at once when one arrived since this last resolved,
     * or once the given time has passed or the signal fired - whichever comes first.
     *
     * A wake up arriving between two calls is kept, so a caller that reads its state and then waits
     * cannot miss the one sent in between.
     * @param timeoutInMs - How long to wait at most.
     * @param signal - Ends the wait early.
     * @returns True when a wake up arrived, false when the time passed or the signal fired.
     */
    next: (timeoutInMs: number, signal?: AbortSignal) => Promise<boolean>,
    /**
     * Stops listening.
     */
    stop: () => void
};