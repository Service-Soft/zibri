/**
 * How long the work running here may take, when somebody said.
 */
export type OperationLimit = {
    /**
     * How long one statement of the work may take, in milliseconds. 0 for no limit.
     *
     * Takes the place of the data source's own statement timeout for as long as the work runs, in
     * either direction: longer for a migration or a bulk write, shorter for a read that is only
     * worth having quickly.
     */
    timeoutInMs: number,
    /**
     * Fires when the work as a whole has run out of time, or when the request it belongs to has.
     *
     * Undefined when neither has a deadline.
     */
    signal: AbortSignal | undefined
};