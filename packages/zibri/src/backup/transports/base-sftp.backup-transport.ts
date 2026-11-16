import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { SftpBackupTransportOptions } from './sftp/sftp-backup-transport-options.model';
import { SftpBackupTransport } from './sftp.backup-transport';
import { optionalPeer } from '../../utilities/optional-peer.function';

/**
 * A transport that stores backups in a folder on a server reached over SFTP. Of both versions, used as `v2`.
 *
 * Backups are kept under `<path>/.zibri-repository/`, and backups of format 1 under `<path>/<backup name>/`. Needs the
 * optional peer dependency `ssh2`.
 * @deprecated Use `SftpBackupTransport`, which 4.0 is the only one of.
 */
// TODO 4.0: remove
export abstract class BaseSftpBackupTransport extends BaseBackupTransport {
    protected abstract readonly options: SftpBackupTransportOptions;

    constructor() {
        super();
        // when the transport is built rather than at the first backup, which can be days after the
        // deployment that left the package out
        optionalPeer('ssh2', 'The sftp backup transport');
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        // per session rather than once: `options` may be a getter, read anew each time as it always was
        return await new SftpBackupTransport(this.name, this.options).openSession();
    }
}