import { InjectableOptions } from '../../di/decorators/injectable.decorator';
import { Newable } from '../../types/newable.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { BackupTransportSupporting } from '../transports/backup-transport.interface';

/**
 * The metadata for a resource marked with \@Backup.
 */
export type BackupResourceMetadata = {
    /**
     * The name of the resource.
     */
    name: string,
    /**
     * The transports that should be used when backing up this resource.
     */
    // TODO 4.0: transports supporting v2 only
    transports: 'all' | Newable<BackupTransportSupporting>[],
    /**
     * Whether the data is encrypted before it leaves the process.
     *
     * Each chunk of it is encrypted with the repository key of the application, or of the tenant for a
     * backup of a tenant, which each transport holds encrypted by the encryption service's `masterEncrypt`.
     * A resource going to a transport used as `v1` is encrypted with a key of its own per backup instead.
     */
    encrypt: boolean
};

/**
 * Input for creating BackupResourceMetadata.
 */
export type BackupResourceMetadataInput<T> = OmitStrict<InjectableOptions<T>, 'variant'>
    & Pick<BackupResourceMetadata, 'transports' | 'encrypt'>
    & Partial<BackupResourceMetadata>;