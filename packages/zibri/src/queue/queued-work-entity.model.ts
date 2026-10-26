import { BaseEntity } from '../entity/base-entity.model';
import { Property } from '../entity/decorators/property.decorator';
import { LoggedError } from '../logging/logged-error.model';

/**
 * A row of work that one instance claims, runs and records, such as a queued mail: how many attempts
 * it took, when it is due again, and what the last one failed with.
 */
export abstract class QueuedWorkEntity extends BaseEntity {
    /**
     * How many attempts were spent on the work.
     */
    @Property.number({ format: 'integer', default: 0 })
    attempts!: number;

    /**
     * When the work is due again after an attempt that failed. Null while it is due now, or once it
     * is over.
     */
    @Property.date({ required: false })
    nextAttemptAt?: Date | null;

    /**
     * What the last attempt failed with. Null after one that succeeded.
     */
    @Property.object({ cls: () => LoggedError, required: false })
    error?: LoggedError | null;
}
