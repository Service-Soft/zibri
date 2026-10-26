import { InternalError } from '../error-handling/internal-error.model';

/**
 * Thrown by an attempt that hands its work back rather than failing, such as one stopped because the
 * application is shutting down: the attempt is not recorded, and whoever claims the work next runs it.
 */
export class QueuedWorkHandedBackError extends InternalError {
    constructor(reason: string) {
        super(`The work was handed back: ${reason}`);
        this.name = 'QueuedWorkHandedBackError';
    }
}
