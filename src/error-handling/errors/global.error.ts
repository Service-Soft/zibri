import { InternalError } from '../internal-error.model';

/**
 * A global error. Is used at the topmost level by eg. The error handler.
 */
export class GlobalError extends InternalError {
    constructor(cause: unknown) {
        super('Global Error', { cause });
        this.name = 'GlobalError';
    }
}