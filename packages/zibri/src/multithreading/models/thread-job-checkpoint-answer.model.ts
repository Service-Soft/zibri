/**
 * What the main thread answers a worker that reported a checkpoint: whether it is stored.
 */
export type ThreadJobCheckpointAnswer = {
    /**
     * The checkpoint is stored on the job's row.
     */
    type: 'checkpointStored',
    /**
     * The id the worker sent the checkpoint with.
     */
    checkpointId: string
} | {
    /**
     * The checkpoint is not stored: another run took the job over, or the write failed.
     */
    type: 'checkpointNotStored',
    /**
     * The id the worker sent the checkpoint with.
     */
    checkpointId: string,
    /**
     * Why it is not stored.
     */
    reason: string
};