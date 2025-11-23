import { Readable } from 'node:stream';

import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';

/**
 * The definition of a transport that handles sending and retrieving backup data.
 */
export interface BackupTransportInterface {
    /**
     * The name of the transport. Is used to resolve the transport when restoring backups, so this should not change.
     */
    readonly name: string,
    /**
     * Stores the given data somewhere.
     */
    storeData: (data: Readable, backup: BackupEntity, resource: BackupResourceEntity) => void | Promise<void>,
    /**
     * Retrieves the backup data for the given resource.
     */
    retrieveData: (backup: BackupEntity, resource: BackupResourceEntity) => Readable | Promise<Readable>,
    /**
     * Deletes the backup data of the given resource.
     */
    deleteData: (backup: BackupEntity, resource: BackupResourceEntity) => void | Promise<void>
}