import { InternalError } from '../error-handling/internal-error.model';

/**
 * Thrown when `updateAll` or `deleteAll` is asked to hand back the rows it changes and more of them
 * match than can be handed back at once.
 *
 * Nothing is updated or deleted. Leave the rows unasked for to be told how many there were, or work
 * through them in pages.
 */
export class UnboundedReturnError extends InternalError {
    constructor(entityName: string, limit: number) {
        super(
            `${entityName}: more than ${limit} entities match, which is more than can be handed back at once.`
            + ' Leave them unasked for to be told how many there were, or work through them in pages.'
        );
        this.name = 'UnboundedReturnError';
    }
}