import { InjectableOptions } from '../../di/decorators/injectable.decorator';
import { OmitStrict } from '../../types/omit-strict.type';
import { BackupTransportInterface } from '../transports/backup-transport.interface';

/**
 * The metadata for a resource marked with \@Backup.
 */
export type BackupResourceMetadata = {
    /**
     * The name of the resource.
     */
    name: string,
    /**
     * The transport that should be used when backing up this resource.
     */
    transports: BackupTransportInterface[]
    // /**
    //  *
    //  */
    // plans: BackupPlan[]
};

/**
 * Input for creating BackupResourceMetadata.
 */
export type BackupResourceMetadataInput<T> = OmitStrict<InjectableOptions<T>, 'variant'>
    & Pick<BackupResourceMetadata, 'transports'>
    & Partial<BackupResourceMetadata>;