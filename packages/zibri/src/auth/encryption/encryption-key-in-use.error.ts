import { InternalError } from '../../error-handling/internal-error.model';

/**
 * An error for deleting a data key that stored values or recorded backups still need, which would
 * leave them unreadable.
 */
export class EncryptionKeyInUseError extends InternalError {
    /**
     * Creates the error naming the keys that are still needed.
     * @param needed - Each key that is still needed, with what needs it, such as
     * `"<id>" (2 stored values, 1 backup)`.
     */
    constructor(needed: string[]) {
        super([
            `Cannot delete a key that is still needed: ${needed.join(', ')}.`,
            'Rotate its values away and let the backups expire first, see resolveRetiredKeyUsage, '
            + 'or pass allowInUse: true to delete it regardless.'
        ]);
        this.name = 'EncryptionKeyInUseError';
    }
}