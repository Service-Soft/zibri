import { BackupTransportInterface } from '../transports';

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
export type BackupResourceMetadataInput = Pick<BackupResourceMetadata, 'transports'> & Partial<BackupResourceMetadata>;