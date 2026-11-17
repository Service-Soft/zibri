import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { S3BackupTransportOptions } from './s3/s3-backup-transport-options.model';
import { S3BackupTransport } from './s3.backup-transport';

/**
 * A transport that stores backups in a bucket of an S3 compatible object storage. Of both versions, used as `v2`.
 *
 * Backups are kept under `<prefix>/.zibri-repository/`, and backups of format 1 under `<prefix>/<backup name>/`. An
 * object larger than one part is uploaded in parts.
 * @deprecated Use `S3BackupTransport`, which 4.0 is the only one of.
 */
// TODO 4.0: remove
export abstract class BaseS3BackupTransport extends BaseBackupTransport {
    protected abstract readonly options: S3BackupTransportOptions;

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        // per session rather than once: `options` may be a getter, read anew each time as it always was
        return await new S3BackupTransport(this.name, this.options).openSession();
    }
}