import { StoredBackupChunk } from './stored-backup-chunk.model';
import { Repository } from '../../data-source/repository/repository';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { BackupChunkEntity, BackupChunkEntityCreateData } from '../backup-chunk-entity.model';
import { BackupTransportSessionInterface } from '../transports/backup-transport-session.interface';

/**
 * How many chunks one round trip looks up or records.
 */
const BATCH_SIZE: number = 100;

/**
 * Which chunks one transport holds, as one resource of a backup asks while it is stored.
 *
 * From the database when the application declares `BackupChunkEntity`, filled from the transport's
 * listing the first time it is empty. Otherwise from a listing of the transport, taken when the
 * resource starts.
 */
export class BackupChunkIndex {
    private readonly recorded: StoredBackupChunk[] = [];

    private constructor(
        private readonly storeName: string,
        private readonly listed: Set<string> | undefined,
        private readonly repository: Repository<BackupChunkEntity, BackupChunkEntityCreateData> | undefined
    ) {}

    /**
     * Opens the index of a transport.
     * @param storeName - The name of the transport.
     * @param session - A session with it, for its listing.
     * @param prefixes - The prefixes chunks are stored under.
     * @param repository - The repository of `BackupChunkEntity`, or undefined when the application does not declare it.
     * @returns The index.
     */
    static async open(
        storeName: string,
        session: BackupTransportSessionInterface,
        prefixes: string[],
        repository: Repository<BackupChunkEntity, BackupChunkEntityCreateData> | undefined
    ): Promise<BackupChunkIndex> {
        if (repository == undefined) {
            return new BackupChunkIndex(storeName, new Set(await this.findKeys(session, prefixes)), undefined);
        }
        const index: BackupChunkIndex = new BackupChunkIndex(storeName, undefined, repository);
        // empty for a transport that holds chunks, after the database was replaced or the transport
        // taken over: filled once, so that a backup does not store everything again. Two instances
        // filling it at once record the same rows
        const [any]: BackupChunkEntity[] = await repository.findAll({ where: { storeName }, limit: 1 });
        if (any == undefined) {
            for (const keys of PromiseUtilities.resolveChunks(await this.findKeys(session, prefixes), BATCH_SIZE)) {
                // the size is not known from a listing, and what reads it counts what it reclaims
                await index.upsert(keys.map(key => ({ key, storedBytes: 0 })));
            }
        }
        return index;
    }

    /**
     * Reads every chunk recorded for a transport.
     * @param storeName - The name of the transport.
     * @param repository - The repository of `BackupChunkEntity`.
     * @returns The keys of the chunks, each with the bytes it takes there, 0 when that is not known.
     */
    static async findRecorded(
        storeName: string,
        repository: Repository<BackupChunkEntity, BackupChunkEntityCreateData>
    ): Promise<Map<string, number>> {
        const recorded: Map<string, number> = new Map();
        const prefix: string = this.resolveRowKey(storeName, '');
        for await (const row of repository.stream({ where: { storeName }, select: ['key', 'storedBytes'] })) {
            recorded.set(row.key.slice(prefix.length), row.storedBytes);
        }
        return recorded;
    }

    /**
     * Deletes the records of chunks of a transport, before the chunks are deleted or once they are found gone.
     * @param storeName - The name of the transport.
     * @param keys - The keys of the chunks.
     * @param repository - The repository of `BackupChunkEntity`.
     */
    static async forget(
        storeName: string,
        keys: string[],
        repository: Repository<BackupChunkEntity, BackupChunkEntityCreateData>
    ): Promise<void> {
        for (const batch of PromiseUtilities.resolveChunks(keys, BATCH_SIZE)) {
            await repository.deleteAll({ key: { oneOf: batch.map(key => this.resolveRowKey(storeName, key)) } });
        }
    }

    /**
     * Finds which of the given keys the transport is known to hold.
     * @param keys - The keys of chunks.
     * @returns The keys it holds.
     */
    async findStored(keys: string[]): Promise<Set<string>> {
        if (this.listed != undefined || this.repository == undefined) {
            return new Set(keys.filter(key => this.listed?.has(key) == true));
        }
        const rows: BackupChunkEntity[] = (await Promise.all(PromiseUtilities.resolveChunks(keys, BATCH_SIZE).map(async batch => {
            return await this.repository?.findAll({
                where: { key: { oneOf: batch.map(key => this.resolveRowKey(key)) } },
                limit: 'all'
            }) ?? [];
        }))).flat();
        const stored: Set<string> = new Set(rows.map(row => row.key));
        return new Set(keys.filter(key => stored.has(this.resolveRowKey(key))));
    }

    /**
     * Notes a chunk the transport now holds, recorded in batches.
     * @param chunk - The chunk.
     */
    async noteStored(chunk: StoredBackupChunk): Promise<void> {
        this.listed?.add(chunk.key);
        this.recorded.push(chunk);
        if (this.recorded.length >= BATCH_SIZE) {
            await this.flush();
        }
    }

    /**
     * Records every chunk noted and not recorded yet. A chunk left unrecorded costs one more upload.
     */
    async flush(): Promise<void> {
        const chunks: StoredBackupChunk[] = this.recorded.splice(0);
        if (chunks.length) {
            await this.upsert(chunks);
        }
    }

    private async upsert(chunks: StoredBackupChunk[]): Promise<void> {
        await this.repository?.upsertAll(['key'], chunks.map(chunk => ({
            create: { key: this.resolveRowKey(chunk.key), storeName: this.storeName, storedBytes: chunk.storedBytes },
            onConflict: { storedBytes: { set: chunk.storedBytes } }
        })));
    }

    private resolveRowKey(key: string): string {
        return BackupChunkIndex.resolveRowKey(this.storeName, key);
    }

    private static resolveRowKey(storeName: string, key: string): string {
        return `${storeName}:${key}`;
    }

    private static async findKeys(session: BackupTransportSessionInterface, prefixes: string[]): Promise<string[]> {
        const keys: string[] = [];
        for (const prefix of prefixes) {
            for await (const page of session.findKeys(prefix)) {
                keys.push(...page);
            }
        }
        return keys;
    }
}