import { MasterKeyReference } from './master-key-reference.model';
import { DataSourceInterface } from '../../data-source/data-sources/data-source.interface';

/**
 * The keys whatever is encrypted right now depends on, and where the data keys are stored.
 */
export type KeysInUse = {
    /**
     * The master key new values are encrypted with.
     */
    currentMasterKey: MasterKeyReference,
    /**
     * The current master key, and every one a data key is still encrypted under.
     */
    masterKeys: MasterKeyReference[],
    /**
     * The ids of every data key.
     */
    dataKeyIds: string[],
    /**
     * The data source the data keys are stored in.
     */
    dataSource: DataSourceInterface
};