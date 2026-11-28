import { StorageNaming } from '../../storage/storage-naming.model';
import { BackupKeyAccessDeniedError } from './backup-key-access-denied.error';
import { BackupKeyNotFoundError } from './backup-key-not-found.error';
import { resolveBackupKeySegments } from './resolve-backup-key-segments.function';

/**
 * Resolves how the sessions of a shipped backup transport name it, and what they throw for a key.
 * @param transportName - The name of the transport.
 * @returns The naming.
 */
export function resolveBackupStorageNaming(transportName: string): StorageNaming {
    return {
        subject: `transport "${transportName}"`,
        resolveKeySegments: key => resolveBackupKeySegments(transportName, key),
        createKeyNotFoundError: key => new BackupKeyNotFoundError(transportName, key),
        createKeyAccessDeniedError: (key, cause) => new BackupKeyAccessDeniedError(transportName, key, cause)
    };
}