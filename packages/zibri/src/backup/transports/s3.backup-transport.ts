import { S3StorageSession } from '../../storage/s3.storage-session';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BaseBackupTransport } from './base.backup-transport';
import { resolveBackupStorageNaming } from './resolve-backup-storage-naming.function';
import { S3BackupTransportOptions } from './s3/s3-backup-transport-options.model';
import { validateS3BucketName } from './s3/validate-s3-bucket-name.function';

/**
 * A transport that stores backups in a bucket of an S3 compatible object storage: each key an object under `prefix`.
 * An object larger than one part is uploaded in parts. Of both versions, used as `v2`.
 *
 * Backups are kept under `<prefix>/.zibri-repository/`, and backups of format 1 under `<prefix>/<backup name>/`.
 */
export class S3BackupTransport extends BaseBackupTransport {
    /**
     * Creates the transport keeping the backups in the given bucket.
     * @param name - The name of the transport.
     * @param options - The bucket, how to reach and sign for it, and how objects are stored in it.
     * @param validateRedirect - What checks where a redirect the service answers with leads, before it is
     * followed, for a bucket that may not reach every host. Without it, a redirect is followed as the http
     * client follows any.
     */
    constructor(
        readonly name: string,
        private readonly options: S3BackupTransportOptions,
        private readonly validateRedirect?: (to: URL) => Promise<void>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async openSession(): Promise<BackupTransportSessionInterface> {
        // only where the bucket is named in the host: in the path it is encoded, and a service may take a
        // name there that no host could hold
        if (this.options.addressingStyle === 'virtual-hosted') {
            validateS3BucketName(this.name, this.options.bucket);
        }
        // a bucket is kept the same way a file store keeps one, so the session is the one both stand on. Every
        // request stands on its own, so a session holds nothing open
        return await Promise.resolve(new S3StorageSession(resolveBackupStorageNaming(this.name), this.options, this.validateRedirect));
    }
}