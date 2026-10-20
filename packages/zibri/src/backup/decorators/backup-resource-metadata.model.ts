import { InjectableOptions } from '../../di/decorators/injectable.decorator.ts';
import { Newable } from '../../types/newable.type.ts';
import { OmitStrict } from '../../types/omit-strict.type.ts';
import { BackupTransportInterface } from '../transports/backup-transport.interface.ts';

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
    transports: 'all' | Newable<BackupTransportInterface>[],
    /**
     * Whether the data is encrypted before it leaves the process.
     *
     * Each backup of this resource is encrypted with a key of its own, which is stored encrypted by the
     * encryption service's `masterEncrypt`.
     */
    encrypt: boolean
    // /**
    //  *
    //  */
    // plans: BackupPlan[]
};

/**
 * Input for creating BackupResourceMetadata.
 */
export type BackupResourceMetadataInput<T> = OmitStrict<InjectableOptions<T>, 'variant'>
    & Pick<BackupResourceMetadata, 'transports' | 'encrypt'>
    & Partial<BackupResourceMetadata>;