import { SftpStorageSession } from '../../storage/sftp.storage-session';
import { optionalPeer } from '../../utilities/optional-peer.function';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { resolveBackupStorageNaming } from './resolve-backup-storage-naming.function';
import { SftpBackupTransportOptions } from './sftp/sftp-backup-transport-options.model';

/**
 * A transport that stores backups in a folder on a server reached over SFTP: each key a file under `path`, its
 * segments the folders leading to it. Of both versions, used as `v2`. Needs the optional peer dependency `ssh2`.
 *
 * Backups are kept under `<path>/.zibri-repository/`, and backups of format 1 under `<path>/<backup name>/`.
 */
export class SftpBackupTransport extends BaseBackupTransport {
    /**
     * Creates the transport keeping the backups on the given server.
     * @param name - The name of the transport.
     * @param options - Where the server is, how to log in, and the folder the backups are kept in.
     */
    constructor(readonly name: string, private readonly options: SftpBackupTransportOptions) {
        super();
        // when the transport is built rather than at the first backup, which can be days after the
        // deployment that left the package out
        optionalPeer('ssh2', 'The sftp backup transport');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        // a server is kept the same way a file store keeps one, so the session is the one both stand on
        return await SftpStorageSession.open(resolveBackupStorageNaming(this.name), this.options, 'The sftp backup transport');
    }
}