/**
 * How `requeueThreadJob` and `rerunThreadJob` put a job back in the queue.
 */
export type RequeueThreadJobOptions = {
    /**
     * Whether the job resumes from the last checkpoint it stored. By default it starts from the
     * beginning, and the checkpoint is thrown away.
     */
    keepCheckpoint?: boolean
};