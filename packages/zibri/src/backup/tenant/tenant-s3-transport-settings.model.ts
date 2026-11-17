import { Property } from '../../entity/decorators/property.decorator';
import { S3BackupTransportOptions } from '../transports/s3/s3-backup-transport-options.model';

/**
 * Where a tenant's bucket is, and the key id it is reached with. The secret of the key is kept apart,
 * encrypted.
 */
export class TenantS3TransportSettings {
    /**
     * The address of the storage, over https.
     */
    @Property.string()
    endpoint!: string;

    /**
     * The bucket.
     */
    @Property.string()
    bucket!: string;

    /**
     * The region of the bucket.
     */
    @Property.string()
    region!: string;

    /**
     * The id of the access key.
     */
    @Property.string()
    accessKeyId!: string;

    /**
     * The folder in the bucket the backups go under, if not its top.
     */
    @Property.string({ required: false })
    prefix?: string | null;

    /**
     * Whether the bucket is named in the host or in the path of each request.
     */
    @Property.string()
    addressingStyle!: S3BackupTransportOptions['addressingStyle'];
}