import { buffer } from 'node:stream/consumers';

import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../logging/logger.interface';
import { Ms } from '../../utilities/ms';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { BackupChunkEntity, BackupChunkEntityCreateData } from '../backup-chunk-entity.model';
import { BackupEntity, BackupEntityCreateData } from '../backup-entity.model';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupStatus } from '../backup-status.enum';
import { InitBackupServiceError } from '../init-backup-service.error';
import { BackupTransportSessionInterface } from '../transports/backup-transport-session.interface';
import { BackupTransportSupporting } from '../transports/backup-transport.interface';
import { BackupChunkIndex } from './backup-chunk-index.model';
import { BackupChunkUtilities } from './backup-chunk.utilities';
import { BackupManifestChunks } from './backup-manifest-chunks.model';
import { BackupRepositoryKey } from './backup-repository-key.model';
import { BackupScrubOptions } from './backup-scrub-options.model';
import { Format2BackupLayout } from './format-2.backup-layout';

/**
 * How many chunks one window deletes: one request of the S3 transport.
 */
const SWEPT_PER_WINDOW: number = 1000;

/**
 * How many backups one round trip of the database reads.
 */
const BACKUPS_PER_READ: number = 100;

// a few at once, so that the round trips of a remote transport overlap
const MANIFESTS_READ_AT_ONCE: number = 4;
const CHUNKS_SCRUBBED_AT_ONCE: number = 4;

/**
 * How many groups the chunks fall into by the first byte of their ids, which a scrub reads a share of each day.
 */
const ID_PREFIXES: number = 256;

/**
 * Runs work while no resource of the application is being stored, so that every manifest on a store is final.
 * The work is handed a signal that aborts once the window is lost.
 */
type GarbageCollectionWindow = <T>(work: (lost: AbortSignal) => Promise<T>) => Promise<T>;

/**
 * A chunk a manifest names.
 */
type NamedChunk = {
    /**
     * The id of the chunk.
     */
    id: string,
    /**
     * How many bytes the chunk holds.
     */
    length: number,
    /**
     * The id of the repository key the chunk is encrypted with, if any.
     */
    keyId: string | undefined
};

/**
 * A manifest whose chunks are needed: of a resource stored completely, of a backup that did not fail.
 */
type NeededManifest = {
    /**
     * The key the manifest is stored under.
     */
    key: string,
    /**
     * The backup.
     */
    backup: BackupEntity,
    /**
     * The resource of the backup.
     */
    resource: BackupResourceEntity
};

/**
 * What the folder of the backups on a store holds.
 */
type BackupFolders = {
    /**
     * The manifests whose chunks are needed.
     */
    needed: NeededManifest[],
    /**
     * What backups stored that nothing restores: no record, and failed or unknown to the database.
     */
    orphanKeys: string[]
};

/**
 * Deletes the chunks of format 2 no backup names any more, and checks the rest.
 */
export class Format2BackupGarbageCollector {
    /**
     * Creates the garbage collector.
     * @param layout - The layout the backups are stored in.
     * @param resolveChunkRepository - The repository of `BackupChunkEntity`, or undefined when the
     * application does not declare it.
     */
    constructor(
        private readonly layout: Format2BackupLayout,
        private readonly resolveChunkRepository: () => Repository<BackupChunkEntity, BackupChunkEntityCreateData> | undefined
    ) {}

    private get backupRepository(): Repository<BackupEntity, BackupEntityCreateData> {
        return inject(repositoryTokenFor(BackupEntity));
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    /**
     * Validates how the chunks are scrubbed.
     * @param options - The options.
     * @throws When they are not usable.
     */
    static validateScrubOptions(options: BackupScrubOptions): void {
        if (!Number.isInteger(options.cycleInDays) || options.cycleInDays < 1 || options.cycleInDays > ID_PREFIXES) {
            throw new InitBackupServiceError(
                `The cycleInDays of ZIBRI_DI_TOKENS.BACKUP_SCRUB_OPTIONS needs to be a whole number from 1 to ${ID_PREFIXES}, `
                + `not ${options.cycleInDays}`
            );
        }
    }

    /**
     * Deletes the chunks a store holds that no backup names, what backups that never finished stored, and what
     * puts that ended part way left behind where the store's sessions delete it, forgets the chunks it no longer holds, and reports the backups naming a chunk that is missing or changed.
     * @param store - The store.
     * @param withWindow - Runs work while no resource of the application is being stored.
     * @param scrub - How the chunks are read back and checked, or undefined to check none.
     */
    async collect(
        store: BackupTransportSupporting<'v2'>,
        withWindow: GarbageCollectionWindow,
        scrub: BackupScrubOptions | undefined
    ): Promise<void> {
        const repository: Repository<BackupChunkEntity, BackupChunkEntityCreateData> | undefined = this.resolveChunkRepository();
        // the records, the manifests and the listing, in this order. A record read before the listing
        // names a chunk stored before it, since a chunk is recorded once it is stored: one not listed is
        // gone. A manifest read before it names chunks stored before it, as it is written last: one it
        // names that is not listed is missing
        const recorded: Map<string, number> = repository == undefined
            ? new Map<string, number>()
            : await BackupChunkIndex.findRecorded(store.name, repository);
        const named: Map<string, NamedChunk> = new Map();
        const read: Set<string> = new Set();
        const [marked, listed, leavesUploads]: [BackupFolders, Set<string>, boolean] = await this.withSession(
            store,
            async (session): Promise<[BackupFolders, Set<string>, boolean]> => {
                const folders: BackupFolders = await this.resolveFolders(store, session);
                await this.readNeeded(store, session, folders.needed, named, read);
                return [folders, await this.findListed(session), session.deleteAbandonedUploads != undefined];
            }
        );

        // forgotten so that the next backup needing one stores it again, which no window is needed for:
        // forgetting a chunk that is there costs an upload, never a backup
        const gone: string[] = [...recorded.keys()].filter(key => !listed.has(key));
        if (repository != undefined && gone.length) {
            await BackupChunkIndex.forget(store.name, gone, repository);
        }
        const missing: Set<string> = new Set([...named.keys()].filter(key => !listed.has(key)));
        const changed: Set<string> = scrub == undefined ? new Set() : await this.scrub(store, named, listed, scrub);
        let candidates: string[] = [...listed].filter(key => !named.has(key));
        listed.clear();
        // a changed chunk goes as well, so that the next backup needing it stores it again
        const changedPending: string[] = [...changed];

        let swept: number = 0;
        let freedBytes: number = 0;
        const orphans: Set<string> = new Set();
        // in the first window, as removing the folders the uploads emptied may not race a put into them
        let uploadsPending: boolean = leavesUploads;
        let pending: boolean = uploadsPending || candidates.length > 0 || changedPending.length > 0 || marked.orphanKeys.length > 0;
        const sweepWindow: (lost: AbortSignal) => Promise<void> = async lost => await this.withSession(store, async session => {
            if (uploadsPending) {
                lost.throwIfAborted();
                await session.deleteAbandonedUploads?.();
                uploadsPending = false;
            }
            // what was stored since: a backup between two windows may have found a candidate stored and named it
            const folders: BackupFolders = await this.resolveFolders(store, session);
            await this.readNeeded(store, session, folders.needed, named, read);
            candidates = candidates.filter(key => !named.has(key));
            // before every deletion: once the window lapsed, a resource may be storing again, and a chunk
            // whose record is gone may have been found missing and put back since
            lost.throwIfAborted();
            if (folders.orphanKeys.length) {
                await session.delete(folders.orphanKeys);
                for (const key of folders.orphanKeys) {
                    orphans.add(this.resolveBackupId(key));
                }
            }
            const batch: string[] = [...changedPending.splice(0), ...candidates.splice(0, SWEPT_PER_WINDOW)];
            if (batch.length) {
                // the records first: one a crash leaves behind says the store holds a chunk it does not
                if (repository != undefined) {
                    lost.throwIfAborted();
                    await BackupChunkIndex.forget(store.name, batch, repository);
                }
                lost.throwIfAborted();
                await session.delete(batch);
                swept += batch.length;
                freedBytes += batch.reduce((sum, key) => sum + (recorded.get(key) ?? 0), 0);
            }
        });
        while (pending) {
            await withWindow(sweepWindow);
            pending = candidates.length > 0;
        }

        if (missing.size || changed.size) {
            await this.reportDamaged(store, marked.needed, missing, changed);
        }
        this.logger.info(
            `Collected the garbage of the backup transport "${store.name}": deleted ${swept} chunks`
            + (freedBytes ? ` (${Math.round(freedBytes / 1024 / 1024)} MiB recorded)` : '')
            + `, what ${orphans.size} backups that never finished stored, and the records of ${gone.length} chunks it no longer held.`
        );
    }

    /**
     * Reads what the folder of the backups on a store holds, and what the database says of each backup.
     * @param store - The store.
     * @param session - A session with it.
     * @returns The manifests whose chunks are needed, and what backups that never finished stored.
     * @throws When the store holds a backup this build could not record, whose chunks it cannot tell.
     */
    private async resolveFolders(store: BackupTransportSupporting<'v2'>, session: BackupTransportSessionInterface): Promise<BackupFolders> {
        const prefix: string = `${Format2BackupLayout.BACKUPS_FOLDER}/`;
        const names: Map<string, string[]> = await this.findNamesByBackup(session, prefix);
        const backups: Map<string, BackupEntity> = await this.findBackups([...names.keys()]);
        const folders: BackupFolders = { needed: [], orphanKeys: [] };
        const unreadable: string[] = [];
        for (const [id, held] of names) {
            const backup: BackupEntity | undefined = backups.get(id);
            const recorded: boolean = held.includes(Format2BackupLayout.RECORD_NAME);
            // one the database says is running is being taken, and one it says is completed is being
            // deleted, which removes the record first: both still name their chunks
            if (!recorded && (backup == undefined || backup.status === BackupStatus.FAILED)) {
                folders.orphanKeys.push(...held.map(name => `${prefix}${id}/${name}`));
                continue;
            }
            if (backup == undefined) {
                // recorded on the store and not in the database: the sync could not read its record
                unreadable.push(id);
                continue;
            }
            // a resource not stored completely is stored again from the start, which stores its chunks again
            for (const resource of backup.resources.filter(r => r.completed && held.includes(r.id))) {
                folders.needed.push({ key: `${prefix}${id}/${resource.id}`, backup, resource });
            }
        }
        if (unreadable.length) {
            throw new InternalError(
                `The backup transport "${store.name}" holds backups that are not recorded, so their chunks cannot be told apart `
                + `from garbage: ${unreadable.join(', ')}. Its garbage is collected once they are synced or deleted.`
            );
        }
        return folders;
    }

    /**
     * Finds what the folder of each backup on a store holds.
     * @param session - A session with the store.
     * @param prefix - The prefix of the keys of the folder of the backups.
     * @returns The names of the files each folder holds, by the id of its backup.
     */
    private async findNamesByBackup(session: BackupTransportSessionInterface, prefix: string): Promise<Map<string, string[]>> {
        const names: Map<string, string[]> = new Map();
        for await (const page of session.findKeys(prefix)) {
            for (const key of page) {
                const [id, name] = key.slice(prefix.length).split('/');
                if (id != undefined && name != undefined) {
                    names.set(id, [...names.get(id) ?? [], name]);
                }
            }
        }
        return names;
    }

    private async findBackups(ids: string[]): Promise<Map<string, BackupEntity>> {
        const backups: BackupEntity[] = (await Promise.all(PromiseUtilities.resolveChunks(ids, BACKUPS_PER_READ).map(async batch => {
            return await this.backupRepository.findAll({ where: { id: { oneOf: batch } }, relations: ['resources'], limit: 'all' });
        }))).flat();
        return new Map(backups.map(backup => [backup.id, backup]));
    }

    /**
     * Reads the chunks the manifests name that were not read yet.
     * @param store - The store.
     * @param session - A session with it.
     * @param needed - The manifests.
     * @param named - The chunks named so far, added to.
     * @param read - The keys of the manifests read so far, added to.
     */
    private async readNeeded(
        store: BackupTransportSupporting<'v2'>,
        session: BackupTransportSessionInterface,
        needed: NeededManifest[],
        named: Map<string, NamedChunk>,
        read: Set<string>
    ): Promise<void> {
        // read once: a manifest of a resource stored completely is never written again
        const unread: NeededManifest[] = needed.filter(manifest => !read.has(manifest.key));
        await PromiseUtilities.allChunked(unread, async manifest => {
            const chunks: BackupManifestChunks | undefined = await this.layout.findChunkEntries(
                store,
                session,
                manifest.backup,
                manifest.resource
            );
            for (const entry of chunks?.entries ?? []) {
                named.set(
                    this.layout.resolveChunkKey(entry.id, chunks?.key),
                    { id: entry.id, length: entry.length, keyId: chunks?.key?.id }
                );
            }
            read.add(manifest.key);
        }, { chunkSize: MANIFESTS_READ_AT_ONCE });
    }

    private async findListed(session: BackupTransportSessionInterface): Promise<Set<string>> {
        const listed: Set<string> = new Set();
        for (const folder of Format2BackupLayout.CHUNK_FOLDERS) {
            for await (const page of session.findKeys(`${folder}/`)) {
                for (const key of page) {
                    listed.add(key);
                }
            }
        }
        return listed;
    }

    /**
     * Reads back the share of the named chunks due today, and checks each against its id.
     * @param store - The store.
     * @param named - The chunks the manifests name.
     * @param listed - The chunks the store holds.
     * @param options - How the chunks are scrubbed.
     * @returns The keys of the chunks that do not hold what was stored.
     */
    private async scrub(
        store: BackupTransportSupporting<'v2'>,
        named: Map<string, NamedChunk>,
        listed: Set<string>,
        options: BackupScrubOptions
    ): Promise<Set<string>> {
        // by the first byte of the id, so that each day reads other chunks without remembering which
        const today: number = Math.floor(Date.now() / Ms.DAY) % options.cycleInDays;
        const due: [string, NamedChunk][] = [...named].filter(([key, chunk]) => {
            return listed.has(key) && Number.parseInt(chunk.id.slice(0, 2), 16) % options.cycleInDays === today;
        });
        const changed: Set<string> = new Set();
        const unread: string[] = [];
        await this.withSession(store, async session => {
            await PromiseUtilities.allChunked(due, async ([key, chunk]) => {
                try {
                    // read a second time before it counts as changed: a chunk deleted on a misread is a
                    // chunk every backup naming it loses
                    const intact: boolean = await this.isIntact(store, session, key, chunk);
                    if (!intact && !await this.isIntact(store, session, key, chunk)) {
                        changed.add(key);
                    }
                }
                catch (error) {
                    unread.push(`${key}: ${error instanceof Error ? error.message : String(error)}`);
                }
            }, { chunkSize: CHUNKS_SCRUBBED_AT_ONCE });
        });
        if (unread.length) {
            this.logger.warn(
                `Could not read ${unread.length} chunks of the backup transport "${store.name}" to check them, such as ${unread[0]}`
            );
        }
        return changed;
    }

    /**
     * Whether a stored chunk holds the data of its id.
     * @param store - The store.
     * @param session - A session with it.
     * @param key - The key it is stored under.
     * @param chunk - The chunk, as its manifest names it.
     * @returns Whether it does.
     * @throws When it cannot be read.
     */
    private async isIntact(
        store: BackupTransportSupporting<'v2'>,
        session: BackupTransportSessionInterface,
        key: string,
        chunk: NamedChunk
    ): Promise<boolean> {
        const repositoryKey: BackupRepositoryKey | undefined = chunk.keyId == undefined
            ? undefined
            : await this.layout.resolveKey(store, session, chunk.keyId);
        const stored: Buffer = await buffer(await session.get(key, chunk.length + BackupChunkUtilities.OVERHEAD_BYTES));
        // what this build cannot read is no sign of a change: a newer build sharing the store wrote it, and
        // deleting it would take it from every backup naming it
        if (BackupChunkUtilities.isOfNewerBuild(stored)) {
            throw new InternalError(`The chunk ${chunk.id} is written by a newer build, which reads it.`);
        }
        try {
            await BackupChunkUtilities.open(stored, chunk.id, repositoryKey, chunk.length);
            return true;
        }
        catch {
            return false;
        }
    }

    /**
     * Reports every resource of a backup that names a chunk missing on the store or changed there.
     * @param store - The store.
     * @param needed - The manifests read before the store was listed.
     * @param missing - The chunks missing.
     * @param changed - The chunks changed, deleted since.
     */
    private async reportDamaged(
        store: BackupTransportSupporting<'v2'>,
        needed: NeededManifest[],
        missing: Set<string>,
        changed: Set<string>
    ): Promise<void> {
        await this.withSession(store, async session => {
            for (const manifest of needed) {
                const chunks: BackupManifestChunks | undefined = await this.layout.findChunkEntries(
                    store,
                    session,
                    manifest.backup,
                    manifest.resource
                );
                const chunkKeys: string[] = (chunks?.entries ?? []).map(entry => this.layout.resolveChunkKey(entry.id, chunks?.key));
                const keys: string[] = [...new Set(chunkKeys)];
                const lacking: number = keys.filter(key => missing.has(key)).length;
                const altered: number = keys.filter(key => changed.has(key)).length;
                if (lacking || altered) {
                    this.logger.error(new InternalError(
                        `The resource "${manifest.resource.name}" of the backup "${manifest.backup.name}" cannot be restored from the `
                        + `backup transport "${store.name}": ${lacking} of its chunks are missing there, `
                        + `and ${altered} do not hold what was `
                        + 'stored. A backup taken from now on stores them again.'
                    ));
                }
            }
        });
    }

    private resolveBackupId(key: string): string {
        return key.slice(Format2BackupLayout.BACKUPS_FOLDER.length + 1).split('/')[0] ?? key;
    }

    private async withSession<T>(
        store: BackupTransportSupporting<'v2'>,
        work: (session: BackupTransportSessionInterface) => Promise<T>
    ): Promise<T> {
        const session: BackupTransportSessionInterface = await store.openSession();
        try {
            return await work(session);
        }
        finally {
            await session.close();
        }
    }
}