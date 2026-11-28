import { InternalError } from '../../error-handling/internal-error.model';
import { StorageNaming } from '../../storage/storage-naming.model';
import { StorageUtilities } from '../../storage/storage.utilities';
import { FileStoreKeyNotFoundError } from './file-store-key-not-found.error';

/**
 * Resolves how the sessions of a shipped file store name it, and what they throw for a key.
 * @param storeName - The name of the file store.
 * @returns The naming.
 */
export function resolveFileStorageNaming(storeName: string): StorageNaming {
    const subject: string = `file store "${storeName}"`;
    return {
        subject,
        resolveKeySegments: key => StorageUtilities.resolveKeySegments(subject, key),
        createKeyNotFoundError: key => new FileStoreKeyNotFoundError(storeName, key),
        createKeyAccessDeniedError: (key, cause) => new InternalError(`The ${subject} may not read "${key}".`, { cause })
    };
}