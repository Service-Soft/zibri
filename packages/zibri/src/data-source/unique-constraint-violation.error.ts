import { ConflictError } from '../error-handling/errors/conflict.error';
import { $ts } from '../localization/translate.function';

/**
 * An error for a write that a unique declaration refuses.
 *
 * One error for every store on purpose. `unique` is declared on the entity rather than on the data
 * source, so an application that has to react to a duplicate - retrying, reporting it, falling back
 * to a read - must not have to know which store refused the write.
 *
 * Over http it answers 409: a value already taken is the caller's to change.
 */
export class UniqueConstraintViolationError extends ConflictError {

    /**
     * The properties whose values are already taken.
     */
    readonly properties: string[];

    constructor(entityName: string, properties: string[], options?: ErrorOptions) {
        super($ts`Another ${entityName} already holds these values for "${properties.join(', ')}".`, options);
        this.name = 'UniqueConstraintViolationError';
        this.properties = properties;
    }
}