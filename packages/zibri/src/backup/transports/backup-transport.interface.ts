import { Readable } from 'node:stream';

import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BackupEntity } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';

/**
 * A version of `BackupTransportInterface`. A transport of `v1` stores each backup itself, a transport of `v2` opens
 * sessions to keys, and where a backup is kept under them is the framework's to say. A transport supporting both is
 * used as the newest.
 */
export type BackupTransportVersion = 'v1' | 'v2';

/**
 * What each version of `BackupTransportInterface` has a transport implement, beside its name.
 */
export type BackupTransportVersionMembers = {
    /**
     * Version 1: the transport stores, finds and deletes each backup itself, in format 1.
     */
    v1: {
        // documents rather than backups, because what a record means is the framework's to say: a
        // transport that read one would have to be taught the shape of a backup, and then every change to
        // that shape would be a change every transport had to make
        /**
         * Hands back the record of every backup this transport holds, as it was stored: each one a
         * document the framework wrote, unopened.
         * @param existingNames - The names of the backups already known about, so a transport can skip fetching them.
         * @deprecated Version 1 of `BackupTransportInterface`, which 4.0 no longer takes.
         */
        resolveBackups: (existingNames: string[]) => string[] | Promise<string[]>,
        /**
         * Stores the given data somewhere.
         * @deprecated Version 1 of `BackupTransportInterface`, which 4.0 no longer takes.
         */
        storeData: (data: Readable, backup: BackupEntity, resource: BackupResourceEntity) => void | Promise<void>,
        /**
         * Stores the record of what the backup is, beside the data it describes.
         *
         * Called once every resource has been stored, which is what lets the record say how large each
         * one turned out and what it sums to. It is the only
         * one that exists when a backup is being restored *because* the database holding the other one is
         * gone - so a restore can only check what it reads against what was written if this is written
         * last. It is also what `resolveBackups` hands back.
         * @param backup - The backup the record describes, to store it under.
         * @param document - The record itself, to be stored as it is.
         * @deprecated Version 1 of `BackupTransportInterface`, which 4.0 no longer takes.
         */
        storeMetadata: (backup: BackupEntity, document: string) => void | Promise<void>,
        /**
         * Retrieves the backup data for the given resource.
         * @deprecated Version 1 of `BackupTransportInterface`, which 4.0 no longer takes.
         */
        retrieveData: (backup: BackupEntity, resource: BackupResourceEntity) => Readable | Promise<Readable>,
        /**
         * Deletes the backup data of the given resource.
         * @deprecated Version 1 of `BackupTransportInterface`, which 4.0 no longer takes.
         */
        deleteData: (backup: BackupEntity, resource: BackupResourceEntity) => void | Promise<void>,
        /**
         * Deletes the record of the given backup, the one `storeMetadata` stored.
         *
         * Called before any data of the backup is deleted, the reverse of how a backup is stored: a delete that is
         * interrupted leaves data without a record, which is what an unfinished backup looks like, and
         * `resolveBackups` does not hand it back.
         * @param backup - The backup whose record is deleted.
         * @deprecated Version 1 of `BackupTransportInterface`, which 4.0 no longer takes.
         */
        deleteMetadata: (backup: BackupEntity) => void | Promise<void>
    },
    /**
     * Version 2: the transport opens sessions that put, get, list and delete data under keys, knowing nothing of
     * backups.
     */
    v2: {
        /**
         * Opens a session, such as a connection to the server the data is kept on.
         * @returns The session, which its caller closes.
         */
        openSession: () => Promise<BackupTransportSessionInterface>
    }
};

/**
 * The members of a version a transport does not support, which it may not define.
 */
type AbsentMembers<T> = { [K in keyof T]?: never };

/**
 * The name every transport has.
 */
type BackupTransportName = {
    /**
     * The name of the transport. Is used to resolve the transport when restoring backups, so this should not change.
     */
    readonly name: string
};

/**
 * What a transport has of `v1`: its members when it supports it, and none of them otherwise.
 */
type V1Part<V extends BackupTransportVersion> = 'v1' extends V
    ? BackupTransportVersionMembers['v1']
    : AbsentMembers<BackupTransportVersionMembers['v1']>;

// a transport of v1 says nothing of v2: every transport of 3.0 is one, and the shipped ones open sessions as well
/**
 * What a transport has of `v2`: its members and the versions it names when it supports it.
 */
type V2Part<V extends BackupTransportVersion> = 'v2' extends V
    ? BackupTransportVersionMembers['v2'] & {
        /**
         * The versions the transport supports.
         */
        readonly versions: readonly V[]
    }
    : {
        /**
         * The versions the transport supports. `v1` when left out.
         */
        readonly versions?: readonly BackupTransportVersion[]
    };

/**
 * A backup transport, implementing the versions it names: `BackupTransportInterface<'v2'>`, or
 * `BackupTransportInterface<'v1' | 'v2'>` for one supporting both. Without a version it is a transport of `v1`.
 *
 * The members of `v1` are `never` on a transport of `v2` alone, so it cannot define one by mistake.
 */
export type BackupTransportInterface<V extends BackupTransportVersion = 'v1'> = BackupTransportName & V1Part<V> & V2Part<V>;

/**
 * A transport supporting the given version, whatever else it supports, such as what takes the sessions of a transport
 * of `v2`. Of several versions, a transport supporting one of them: `backupTransports` takes one of any version.
 */
export type BackupTransportSupporting<V extends BackupTransportVersion = BackupTransportVersion> = V extends BackupTransportVersion
    ? {
        /**
         * The name of the transport.
         */
        readonly name: string
    } & BackupTransportVersionMembers[V]
    : never;

/**
 * The members a transport of `v1` has, beside its name.
 */
const V1_MEMBERS: (keyof BackupTransportVersionMembers['v1'])[] = [
    'deleteData',
    'deleteMetadata',
    'resolveBackups',
    'retrieveData',
    'storeData',
    'storeMetadata'
];

/**
 * Checks whether or not the given value is a backup transport of version 1.
 * @param value - The value to check.
 * @param version - The version it needs to support, `v1` when left out.
 * @returns True if the value has all the members of the version.
 */
export function isBackupTransport(value: unknown, version?: 'v1'): value is BackupTransportInterface;
/**
 * Checks whether or not the given value is a backup transport of version 2: one that names `v2` among its `versions`
 * and opens sessions.
 * @param value - The value to check.
 * @param version - The version it needs to support.
 * @returns True if the value supports the version.
 */
export function isBackupTransport(value: unknown, version: 'v2'): value is BackupTransportSupporting<'v2'>;
export function isBackupTransport(value: unknown, version: BackupTransportVersion = 'v1'): boolean {
    if (value == undefined || typeof value !== 'object' || !('name' in value)) {
        return false;
    }
    return version === 'v1' ? V1_MEMBERS.every(member => member in value) : isTransportOfV2(value);
}

/**
 * Whether a value names `v2` among its `versions` and opens sessions.
 * @param value - The value.
 * @returns True when it does.
 */
function isTransportOfV2(value: object): boolean {
    return 'versions' in value
        && Array.isArray(value.versions)
        && value.versions.includes('v2')
        && 'openSession' in value
        && typeof value.openSession === 'function';
}