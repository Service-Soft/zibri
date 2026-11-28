import { StorageUtilities } from '../../storage/storage.utilities';

/**
 * The segments of a key of a backup transport, for a transport that keeps what its keys hold as files.
 * @param transportName - The name of the transport, for the error.
 * @param key - The key.
 * @returns Its `/`-separated segments.
 * @throws When a segment is empty, `.` or `..`, or holds a backslash or a null character, any of which
 * could lead the file outside the transport's folder.
 */
export function resolveBackupKeySegments(transportName: string, key: string): string[] {
    return StorageUtilities.resolveKeySegments(`backup transport "${transportName}"`, key);
}