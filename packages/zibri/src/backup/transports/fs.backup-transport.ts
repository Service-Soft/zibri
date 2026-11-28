import { FsStorageSession } from '../../storage/fs.storage-session';
import { FsPath } from '../../utilities/fs.utilities';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { resolveBackupStorageNaming } from './resolve-backup-storage-naming.function';

/**
 * A transport that keeps the backups in a folder of this instance's own disk: each key a file, its segments the
 * folders leading to it. Of both versions, used as `v2`.
 *
 * Backups are kept under `<folder>/.zibri-repository/`, and backups of format 1 under `<folder>/<backup name>/`.
 */
export class FsBackupTransport extends BaseBackupTransport {
    /**
     * Creates the transport keeping the backups in the given folder.
     * @param name - The name of the transport.
     * @param folder - The folder the backups are kept in.
     */
    constructor(readonly name: string, private readonly folder: FsPath) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        // a folder is kept the same way a file store keeps one, so the session is the one both stand on
        return await Promise.resolve(new FsStorageSession(resolveBackupStorageNaming(this.name), this.folder));
    }
}