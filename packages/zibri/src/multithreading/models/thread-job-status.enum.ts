/**
 * The status that a thread job can have.
 */
export enum ThreadJobStatus {
    IN_QUEUE = 'IN_QUEUE',
    IN_PROGRESS = 'IN_PROGRESS',
    /**
     * The process running it stopped on purpose before it was done.
     *
     * Its own state rather than putting the job back to `IN_QUEUE`, because a job that ran halfway
     * and a job that never started are not the same thing, and the row is the only place that can
     * say which. It is also what makes the graceful case exact: an interrupted job is taken back the
     * moment anything starts, where an `IN_PROGRESS` row has to be judged by its timeout first.
     *
     * Only a shutdown that got to run writes this. A process that was killed leaves `IN_PROGRESS`.
     */
    INTERRUPTED = 'INTERRUPTED',
    COMPLETED = 'COMPLETED',
    FAILED = 'FAILED',
    CANCELLED = 'CANCELLED'
}