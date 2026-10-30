import { InternalError } from '../error-handling/internal-error.model';

/**
 * The error `reportCheckpoint` rejects with when the checkpoint is not stored: another run took the
 * job over, or the write failed. The run that gets it stops, since a rerun resumes from the last
 * checkpoint that was stored.
 */
export class ThreadJobCheckpointNotStoredError extends InternalError {
    constructor(reason: string) {
        super(['The checkpoint of the thread job was not stored.', reason]);
        this.name = 'ThreadJobCheckpointNotStoredError';
    }
}