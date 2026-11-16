import { Readable } from 'node:stream';
import { text } from 'node:stream/consumers';

import { BackupKeyAccessDeniedError } from './backup-key-access-denied.error';
import { BackupKeyNotFoundError } from './backup-key-not-found.error';
import { BackupTransportSessionInterface } from './backup-transport-session.interface';
import { BackupTransportInterface, BackupTransportVersion } from './backup-transport.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { LoggerInterface } from '../../logging/logger.interface';
import { BackupEntity } from '../backup-entity.model';
import { BACKUP_REPOSITORY_FOLDER } from '../backup-format';
import { BackupResourceEntity } from '../backup-resource-entity.model';

const METADATA_FILENAME: string = 'metadata.json';

/**
 * The most the record of a backup may weigh: it names the backup and its resources, which is far below this.
 */
const MAX_METADATA_BYTES: number = 10 * 1024 * 1024;

/**
 * A transport of both versions, whose sessions the members of `v1` store through in format 1: each resource under
 * `<backup name>/<resource name>`, and the record of the backup under `<backup name>/metadata.json` beside it. A
 * subclass implements `name` and `openSession`.
 */
// TODO 4.0: drop the members of v1, with v1 of BackupTransportInterface, once format 1 backups are read through
// sessions alone. They are the keys the transports of 3.0 wrote, so every backup they wrote is found where it is
export abstract class BaseBackupTransport implements BackupTransportInterface<BackupTransportVersion> {
    abstract readonly name: string;

    /**
     * The versions the transport supports, used as the newest: `v2`. A subclass of 3.0 overriding a member of `v1`
     * names `['v1']`, so that its members are used until 4.0.
     */
    readonly versions: readonly BackupTransportVersion[] = ['v1', 'v2'];

    abstract openSession(): Promise<BackupTransportSessionInterface>;

    // the members of v1 work through functions of this file rather than private members: a subclass written
    // against the transports of 3.0 may declare a private member of any name, which one here would clash with

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveBackups(existingNames: string[]): Promise<string[]> {
        return await withSession(this, async session => {
            // the names at the top rather than every key, which with the chunks of deduplicated backups
            // in the same store would be thousands of keys to list for a handful of names
            const names: string[] = [];
            for await (const page of session.findNames('')) {
                names.push(...page.filter(n => n !== BACKUP_REPOSITORY_FOLDER && !existingNames.includes(n)));
            }
            const documents: (string | undefined)[] = await Promise.all(
                names.map(async name => await findDocument(this, session, name))
            );
            return documents.filter(d => d != undefined);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async storeData(data: Readable, backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        await withSession(this, async session => await session.put(resolveResourceKey(backup, resource), data));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async storeMetadata(backup: BackupEntity, document: string): Promise<void> {
        await withSession(
            this,
            async session => await session.put(resolveMetadataKey(backup.name), Readable.from([Buffer.from(document)]))
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async retrieveData(backup: BackupEntity, resource: BackupResourceEntity): Promise<Readable> {
        if (resource.size == undefined) {
            throw new InternalError(`The backup "${backup.name}" recorded no size for "${resource.name}", so it cannot be retrieved.`);
        }
        const session: BackupTransportSessionInterface = await this.openSession();
        try {
            // no larger than what was stored: data that has grown since is refused, rather than written
            // to disk in full first
            const data: Readable = await session.get(resolveResourceKey(backup, resource), resource.size);
            // the session belongs to the stream from here on, until it is read or destroyed
            data.once('close', () => closeSession(this.name, session));
            return data;
        }
        catch (error) {
            closeSession(this.name, session);
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteData(backup: BackupEntity, resource: BackupResourceEntity): Promise<void> {
        await withSession(this, async session => await session.delete([resolveResourceKey(backup, resource)]));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteMetadata(backup: BackupEntity): Promise<void> {
        await withSession(this, async session => await session.delete([resolveMetadataKey(backup.name)]));
    }
}

/**
 * The logger the members of `v1` warn through.
 * @returns The logger.
 */
function getLogger(): LoggerInterface {
    return inject(ZIBRI_DI_TOKENS.LOGGER);
}

/**
 * The record of a backup that is not recorded here yet, as it was stored.
 * @param transport - The transport the session is of.
 * @param session - The session.
 * @param name - The name the backup is kept under.
 * @returns The record, or undefined when there is none.
 */
async function findDocument(
    transport: BaseBackupTransport,
    session: BackupTransportSessionInterface,
    name: string
): Promise<string | undefined> {
    try {
        // as text: the record is handed back as it was stored, never parsed here
        return await text(await session.get(resolveMetadataKey(name), MAX_METADATA_BYTES));
    }
    catch (error) {
        // a folder the application may not read, such as the lost+found at the top of a disk, is no
        // backup it could restore from, and the backups beside it are synced still. Whatever else
        // fails the sync, where skipping would leave a backup out of it without anyone noticing
        if (error instanceof BackupKeyAccessDeniedError) {
            getLogger().warn(`Skipped "${name}" in the transport "${transport.name}" while resolving backups: ${error.message}`);
            return undefined;
        }
        if (!(error instanceof BackupKeyNotFoundError)) {
            throw error;
        }
    }
    // a name holding no key is no backup: a key directly at the top, or a folder left empty
    for await (const page of session.findKeys(`${name}/`)) {
        if (page.length) {
            // a backup holding data and no record is one that was interrupted before it finished: the
            // record is the last thing written, precisely so that this is what a half-finished one
            // looks like from here
            getLogger().warn(`Could not find the metadata file needed to resolve a backup: "${name}" in the transport "${transport.name}"`);
            return undefined;
        }
    }
    return undefined;
}

/**
 * Runs work on a session of its own, closed once the work is done.
 * @param transport - The transport to open the session of.
 * @param work - The work.
 * @returns What the work returns.
 */
async function withSession<T>(transport: BaseBackupTransport, work: (session: BackupTransportSessionInterface) => Promise<T>): Promise<T> {
    const session: BackupTransportSessionInterface = await transport.openSession();
    try {
        return await work(session);
    }
    finally {
        await session.close();
    }
}

/**
 * Closes a session without waiting for it, warning when that fails.
 * @param transportName - The name of the transport the session is of.
 * @param session - The session.
 */
function closeSession(transportName: string, session: BackupTransportSessionInterface): void {
    // what was fetched is in hand by now: a session that fails to close loses nothing of it
    void (async (): Promise<void> => {
        try {
            await session.close();
        }
        catch (error) {
            getLogger().warn(
                `Could not close a session of the transport "${transportName}": ${error instanceof Error ? error.message : String(error)}`
            );
        }
    })();
}

/**
 * The key a resource of a backup of format 1 is kept under.
 * @param backup - The backup.
 * @param resource - The resource.
 * @returns The key.
 */
function resolveResourceKey(backup: BackupEntity, resource: BackupResourceEntity): string {
    return `${backup.name}/${resource.name}`;
}

/**
 * The key the record of a backup of format 1 is kept under.
 * @param backupName - The name of the backup.
 * @returns The key.
 */
function resolveMetadataKey(backupName: string): string {
    return `${backupName}/${METADATA_FILENAME}`;
}