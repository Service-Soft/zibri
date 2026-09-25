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
     * Hands back the record of every backup this transport holds, as it was stored.
     *
     * Documents rather than backups, because what a record means is the framework's to say: a
     * transport that read one would have to be taught the shape of a backup, and then every change to
     * that shape would be a change every transport had to make. Storing and returning it unopened is
     * what keeps a transport a place to put bytes.
     * @param existingNames - The names of the backups already known about, so a transport can skip fetching them.
     */
    resolveBackups: (existingNames: string[]) => string[] | Promise<string[]>,
    /**
     * Stores the given data somewhere.
     */
    storeData: (data: Readable, backup: BackupEntity, resource: BackupResourceEntity) => void | Promise<void>,
    /**
     * Stores the record of what the backup is, beside the data it describes.
     *
     * Called once every resource has been stored, which is what lets the record say how large each
     * one turned out and what it sums to. It is the only
     * one that exists when a backup is being restored *because* the database holding the other one is
     * gone - so a restore can only check what it reads against what was written if this is written
     * last. It is also what {@link BackupTransportInterface.resolveBackups} hands back.
     * @param backup - The backup the record describes, to store it under.
     * @param document - The record itself, to be stored as it is.
     */
    storeMetadata: (backup: BackupEntity, document: string) => void | Promise<void>,
    /**
     * Retrieves the backup data for the given resource.
     */
    retrieveData: (backup: BackupEntity, resource: BackupResourceEntity) => Readable | Promise<Readable>,
    /**
     * Deletes the backup data of the given resource.
     */
    deleteData: (backup: BackupEntity, resource: BackupResourceEntity) => void | Promise<void>,
    /**
     * Deletes the record of the given backup, the one {@link BackupTransportInterface.storeMetadata} stored.
     *
     * Called before any data of the backup is deleted, the reverse of how a backup is stored: a delete that is
     * interrupted leaves data without a record, which is what an unfinished backup looks like, and
     * {@link BackupTransportInterface.resolveBackups} does not hand it back.
     * @param backup - The backup whose record is deleted.
     */
    deleteMetadata: (backup: BackupEntity) => void | Promise<void>
}

/**
 * Checks whether or not the given value is a backup transport.
 * @param value - The value to check.
 * @returns True if the value has all the keys of UserRepositoryInterface, false otherwise.
 */
export function isBackupTransport(value: unknown): value is BackupTransportInterface {
    const keys: (keyof BackupTransportInterface)[] = [
        'name',
        'deleteData',
        'deleteMetadata',
        'resolveBackups',
        'retrieveData',
        'storeData',
        'storeMetadata'
    ];

    if (value == undefined || typeof value !== 'object') {
        return false;
    }

    for (const key of keys) {
        if (!(key in value)) {
            return false;
        }
    }

    return true;
}