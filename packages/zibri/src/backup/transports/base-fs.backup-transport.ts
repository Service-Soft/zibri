import { FsPath } from '../../utilities/fs.utilities';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { FsBackupTransport } from './fs.backup-transport';

/**
 * A transport that keeps the backups in a folder of this instance's own disk, `backupBasePath`. Of both versions,
 * used as `v2`.
 *
 * Backups are kept under `<backupBasePath>/.zibri-repository/`, and backups of format 1 under
 * `<backupBasePath>/<backup name>/`.
 * @deprecated Use `FsBackupTransport`, which 4.0 is the only one of.
 */
// TODO 4.0: remove
export abstract class BaseFsBackupTransport extends BaseBackupTransport {
    protected abstract readonly backupBasePath: FsPath;

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        return await new FsBackupTransport(this.name, this.backupBasePath).openSession();
    }
}