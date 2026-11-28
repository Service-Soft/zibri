import { ConflictError } from '../error-handling/errors/conflict.error';
import { $ts } from '../localization/translate.function';

/**
 * An error for the delete of a row of an archived entity before its retention ended, naming the row and when it may
 * be deleted. Answers 409.
 */
export class ArchiveRetentionError extends ConflictError {
    /**
     * The id of the row.
     */
    readonly rowId: string;

    /**
     * When its retention ends, from which it may be deleted.
     */
    readonly retainUntil: Date;

    /**
     * Creates the error for the row that was refused.
     * @param entityName - The name of the archived entity.
     * @param rowId - The id of the row.
     * @param retainUntil - When its retention ends.
     */
    constructor(entityName: string, rowId: string, retainUntil: Date) {
        super($ts`The ${entityName} "${rowId}" is archived until ${retainUntil.toISOString()}, and can be deleted from then on.`);
        this.name = 'ArchiveRetentionError';
        this.rowId = rowId;
        this.retainUntil = retainUntil;
    }
}