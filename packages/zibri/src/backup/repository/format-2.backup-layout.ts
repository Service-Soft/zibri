import { randomBytes } from 'node:crypto';
import { Readable } from 'node:stream';
import { buffer, text } from 'node:stream/consumers';

import { BackupChunkIndex } from './backup-chunk-index.model';
import { BackupChunkUtilities } from './backup-chunk.utilities';
import { BackupChunkingOptions } from './backup-chunking-options.model';
import { BackupChunkingUtilities } from './backup-chunking.utilities';
import { BackupManifestChunks } from './backup-manifest-chunks.model';
import { BackupManifestEntry } from './backup-manifest-entry.model';
import { BackupManifestUtilities } from './backup-manifest.utilities';
import { BackupRepositoryKey } from './backup-repository-key.model';
import { BackupStoredResource } from './backup-stored-resource.model';
import { RetrievedBackupResource } from './retrieved-backup-resource.model';
import { type EncryptionServiceInterface } from '../../auth/encryption/encryption-service.interface';
import { EncryptionContent, EncryptionString, EncryptionUtilities } from '../../auth/encryption/encryption.utilities';
import { Repository } from '../../data-source/repository/repository';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { type LeaseServiceInterface } from '../../leases/lease-service.interface';
import { type LoggerInterface } from '../../logging/logger.interface';
import { JsonUtilities } from '../../utilities/json.utilities';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { BackupChunkEntity, BackupChunkEntityCreateData } from '../backup-chunk-entity.model';
import { BackupDigest } from '../backup-digest.model';
import { BackupEntity } from '../backup-entity.model';
import { BACKUP_REPOSITORY_FOLDER } from '../backup-format';
import { BackupResourceEntity } from '../backup-resource-entity.model';
import { BackupKeyNotFoundError } from '../transports/backup-key-not-found.error';
import { BackupTransportSessionInterface } from '../transports/backup-transport-session.interface';
import { BackupTransportSupporting } from '../transports/backup-transport.interface';

const KEYS_FOLDER: string = `${BACKUP_REPOSITORY_FOLDER}/keys`;
const CHUNKS_FOLDER: string = `${BACKUP_REPOSITORY_FOLDER}/chunks`;
const PLAIN_CHUNKS_FOLDER: string = `${BACKUP_REPOSITORY_FOLDER}/plain-chunks`;
const BACKUPS_FOLDER: string = `${BACKUP_REPOSITORY_FOLDER}/backups`;
const RECORD_NAME: string = 'record.json';

/**
 * The most the record of a backup may weigh: it names the backup and its resources, which is far below this.
 */
const MAX_RECORD_BYTES: number = 10 * 1024 * 1024;

/**
 * The most a stored repository key may weigh: an id and the key encrypted by the master key.
 */
const MAX_KEY_DOCUMENT_BYTES: number = 64 * 1024;

// a few at once, so that the round trips of a remote transport overlap. Each holds a chunk and its
// sealed copy, which is what the memory of a backup or a restore grows by
const PUTS_IN_FLIGHT: number = 4;
const CHUNKS_FETCHED_AHEAD: number = 4;

/**
 * A repository key as a transport stores it: encrypted by the master key, which a restore with the
 * database gone still has.
 */
type RepositoryKeyDocument = {
    /**
     * The id of the key.
     */
    id: string,
    /**
     * The key, encrypted by the master key.
     */
    wrapped: EncryptionContent
};

/**
 * Why storing a chunk failed.
 */
type ChunkStoreFailure = {
    /**
     * What storing the chunk threw.
     */
    error: unknown
};

/**
 * Format 2 of the backups, kept in a blob store: the data of each resource cut into chunks, each stored
 * once under its id, a manifest per resource listing them, and the record of the backup written last.
 * Everything under one folder at the top of the store, beside the backups of format 1.
 */
export class Format2BackupLayout {
    /**
     * The folder the backups are kept in, each in a folder of its own named by its id, holding its record
     * and what each resource is stored under.
     */
    static readonly BACKUPS_FOLDER: string = BACKUPS_FOLDER;

    /**
     * The folders the chunks are kept in: of encrypted resources, and of unencrypted ones.
     */
    static readonly CHUNK_FOLDERS: string[] = [CHUNKS_FOLDER, PLAIN_CHUNKS_FOLDER];

    /**
     * The name of the record in the folder of a backup.
     */
    static readonly RECORD_NAME: string = RECORD_NAME;

    private readonly keys: Map<string, BackupRepositoryKey> = new Map();
    // by store, which key it holds: a store holding a key of its own is encrypted under that one, never
    // under whichever key was resolved last
    private readonly keyIdsByStore: Map<string, string> = new Map();
    // by owner, the key a store of it holding none is given: the first one this process resolved for it.
    // Never another owner's, so that the storage of a tenant holds no key but its own
    private readonly keyIdsByOwner: Map<string, string> = new Map();
    private readonly keysResolving: Map<string, Promise<BackupRepositoryKey>> = new Map();
    private readonly gearTables: Map<string, Int32Array> = new Map();

    /**
     * Creates the layout.
     * @param resolveChunkRepository - The repository of `BackupChunkEntity`, or undefined when the
     * application does not declare it.
     */
    constructor(
        private readonly resolveChunkRepository: () => Repository<BackupChunkEntity, BackupChunkEntityCreateData> | undefined
    ) {}

    private get encryptionService(): EncryptionServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
    }

    private get leaseService(): LeaseServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }

    private get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    private get options(): BackupChunkingOptions {
        return inject(ZIBRI_DI_TOKENS.BACKUP_CHUNKING_OPTIONS);
    }

    /**
     * Stores the data of a resource as chunks on every given store, each chunk only where it is not yet,
     * and the manifest listing them once they all are.
     * @param stores - The stores.
     * @param backup - The backup being created.
     * @param resource - The resource being stored.
     * @param data - Its data.
     * @param key - The repository key to encrypt the chunks with, from {@link resolveRepositoryKey}, or
     * undefined to store them unencrypted.
     * @param lost - Aborts once the lease the resource is stored under is lost, after which no manifest is
     * written.
     * @returns The size of the data and its checksum, which {@link BackupManifestUtilities.resolveChecksum} says.
     */
    async storeChunks(
        stores: BackupTransportSupporting<'v2'>[],
        backup: BackupEntity,
        resource: BackupResourceEntity,
        data: AsyncIterable<unknown>,
        key: BackupRepositoryKey | undefined,
        lost: AbortSignal
    ): Promise<BackupDigest> {
        const options: BackupChunkingOptions = this.options;
        return await this.withSessions(stores, async sessions => {
            const indexes: BackupChunkIndex[] = await Promise.all(stores.map(async (store, i) => await BackupChunkIndex.open(
                store.name,
                this.getAt(sessions, i),
                Format2BackupLayout.CHUNK_FOLDERS.map(folder => `${folder}/`),
                this.resolveChunkRepository()
            )));
            let size: number = 0;
            // by position, as each id is known once its chunk is hashed, in whichever order that ends
            const lengths: number[] = [];
            const ids: string[] = [];
            // a chunk that comes up twice in one resource is stored once
            const handled: Set<string> = new Set();
            const inFlight: Set<Promise<void>> = new Set();
            let failure: ChunkStoreFailure | undefined;
            const noteFailure: (error: unknown) => void = error => {
                failure ??= { error };
            };
            try {
                for await (const chunk of BackupChunkingUtilities.cut(data, this.resolveGearTable(key), options)) {
                    size += chunk.length;
                    const position: number = lengths.length;
                    lengths.push(chunk.length);
                    const stored: Promise<void> = (async () => {
                        const id: string = await BackupChunkUtilities.resolveId(chunk, key);
                        ids[position] = id;
                        if (!handled.has(id)) {
                            handled.add(id);
                            await this.storeChunk(chunk, id, key, sessions, indexes, options.compressionLevel);
                        }
                    })()
                        .catch(noteFailure)
                        .finally(() => inFlight.delete(stored));
                    inFlight.add(stored);
                    if (inFlight.size >= PUTS_IN_FLIGHT) {
                        await Promise.race(inFlight);
                    }
                    if (failure != undefined) {
                        break;
                    }
                }
            }
            finally {
                // every put done before the sessions close, whether the data ended or failed
                await Promise.all(inFlight);
            }
            if (failure != undefined) {
                throw failure.error;
            }
            const entries: BackupManifestEntry[] = lengths.map((length, i) => ({ id: this.getAt(ids, i), length }));
            await Promise.all(indexes.map(async index => await index.flush()));
            // the lease is what keeps a garbage collection from deleting the chunks this found stored. Once
            // it lapsed, one may have, and a manifest naming them would name nothing
            lost.throwIfAborted();
            // only now: a manifest names chunks the store holds, and none it might not
            const manifest: Buffer = await BackupManifestUtilities.encodeChunks(entries, key);
            await this.settleAll(sessions.map(
                async session => await session.put(this.resolveResourceKey(backup, resource), Readable.from([manifest]))
            ));
            return { size, checksum: BackupManifestUtilities.resolveChecksum(entries, key) };
        });
    }

    /**
     * Stores the data of a resource in one piece, the way the transports of format 1 store it, for a
     * resource of a backup that also goes to a transport which stores nothing else.
     * @param store - The store.
     * @param backup - The backup being created.
     * @param resource - The resource being stored.
     * @param data - Its data, as format 1 stores it.
     */
    async storeWhole(
        store: BackupTransportSupporting<'v2'>,
        backup: BackupEntity,
        resource: BackupResourceEntity,
        data: Readable
    ): Promise<void> {
        await this.withSessions([store], async ([session]) => {
            await session?.put(
                this.resolveResourceKey(backup, resource),
                Readable.from(this.prepend(BackupManifestUtilities.resolveWholeHeader(), data))
            );
        });
    }

    /**
     * Stores the record of a backup, once every resource of it is stored.
     * @param store - The store.
     * @param backup - The backup.
     * @param document - The record.
     */
    async storeRecord(store: BackupTransportSupporting<'v2'>, backup: BackupEntity, document: string): Promise<void> {
        await this.withSessions([store], async ([session]) => {
            await session?.put(this.resolveRecordKey(backup.id), Readable.from([Buffer.from(document)]));
        });
    }

    /**
     * Reads the records of the backups a store holds and the caller does not know of yet.
     * @param store - The store.
     * @param existingIds - The ids of the backups the caller knows.
     * @returns The records, as they were stored.
     */
    async resolveRecords(store: BackupTransportSupporting<'v2'>, existingIds: string[]): Promise<string[]> {
        return await this.withSessions([store], async ([session]) => {
            if (session == undefined) {
                return [];
            }
            const ids: string[] = [];
            for await (const page of session.findNames(BACKUPS_FOLDER)) {
                ids.push(...page.filter(id => !existingIds.includes(id)));
            }
            const documents: (string | undefined)[] = await Promise.all(ids.map(async id => await this.findRecord(store, session, id)));
            return documents.filter(d => d != undefined);
        });
    }

    /**
     * Hands back the data of a resource, rebuilt from its chunks or as it was stored in one piece.
     * @param store - The store.
     * @param backup - The backup being restored.
     * @param resource - The resource.
     * @param keyBytes - The repository key as the backup recorded it for the resource, already decrypted
     * by the master key: its id key and its data key. Read from the store when undefined.
     * @returns The data. The store's session belongs to it until it is read or destroyed.
     * @throws When a chunk or the manifest is not what was stored.
     */
    async retrieve(
        store: BackupTransportSupporting<'v2'>,
        backup: BackupEntity,
        resource: BackupResourceEntity,
        keyBytes: Buffer | undefined
    ): Promise<RetrievedBackupResource> {
        if (resource.size == undefined) {
            throw new InternalError(`The backup "${backup.name}" recorded no size for "${resource.name}", so it cannot be retrieved.`);
        }
        const session: BackupTransportSessionInterface = await store.openSession();
        try {
            const stored: Readable = await session.get(
                this.resolveResourceKey(backup, resource),
                BackupManifestUtilities.resolveMaxBytes(resource.size)
            );
            const read: BackupStoredResource = await BackupManifestUtilities.read(stored);
            if (read.kind === 'whole') {
                return { kind: 'whole', data: this.closingWith(Readable.from(read.data), store, session) };
            }
            // a resource the backup recorded a key for was stored encrypted: unencrypted chunks in its place
            // were put there by someone else, and a plain checksum over them is one anybody can compute
            if (keyBytes != undefined && read.keyId == undefined) {
                throw new InternalError(
                    `The backup "${backup.name}" recorded "${resource.name}" as encrypted, `
                    + `and the transport "${store.name}" holds it unencrypted.`
                );
            }
            let key: BackupRepositoryKey | undefined;
            if (read.keyId != undefined) {
                key = keyBytes == undefined ? await this.resolveKey(store, session, read.keyId) : this.toKey(read.keyId, keyBytes);
            }
            const entries: BackupManifestEntry[] = await BackupManifestUtilities.decodeEntries(read.body, key);
            return {
                kind: 'chunks',
                data: this.closingWith(Readable.from(this.fetchChunks(session, entries, key)), store, session),
                size: entries.reduce((sum, entry) => sum + entry.length, 0),
                checksum: BackupManifestUtilities.resolveChecksum(entries, key)
            };
        }
        catch (error) {
            this.closeSession(store, session);
            throw error;
        }
    }

    /**
     * Reads which chunks the manifest of a resource names.
     * @param store - The store.
     * @param session - A session with it.
     * @param backup - The backup.
     * @param resource - The resource, stored completely.
     * @returns The chunks and their key, or undefined for a resource stored in one piece.
     * @throws When the manifest is not what was stored.
     */
    async findChunkEntries(
        store: BackupTransportSupporting<'v2'>,
        session: BackupTransportSessionInterface,
        backup: BackupEntity,
        resource: BackupResourceEntity
    ): Promise<BackupManifestChunks | undefined> {
        if (resource.size == undefined) {
            throw new InternalError(`The backup "${backup.name}" recorded no size for "${resource.name}", so its manifest cannot be read.`);
        }
        const stored: Readable = await session.get(
            this.resolveResourceKey(backup, resource),
            BackupManifestUtilities.resolveMaxBytes(resource.size)
        );
        const read: BackupStoredResource = await BackupManifestUtilities.read(stored);
        if (read.kind === 'whole') {
            // names no chunk, and none of its data is wanted
            stored.destroy();
            return undefined;
        }
        const key: BackupRepositoryKey | undefined = read.keyId == undefined
            ? undefined
            : await this.resolveKey(store, session, read.keyId);
        return { key, entries: await BackupManifestUtilities.decodeEntries(read.body, key) };
    }

    /**
     * Deletes the record of a backup, which a sync then no longer finds.
     * @param store - The store.
     * @param backup - The backup.
     */
    async deleteRecord(store: BackupTransportSupporting<'v2'>, backup: BackupEntity): Promise<void> {
        await this.withSessions([store], async ([session]) => await session?.delete([this.resolveRecordKey(backup.id)]));
    }

    /**
     * Deletes what resources of a backup stored, except their chunks, which other backups may share.
     * @param store - The store.
     * @param backup - The backup.
     * @param resources - The resources.
     */
    async deleteResources(store: BackupTransportSupporting<'v2'>, backup: BackupEntity, resources: BackupResourceEntity[]): Promise<void> {
        await this.withSessions(
            [store],
            async ([session]) => await session?.delete(resources.map(r => this.resolveResourceKey(backup, r)))
        );
    }

    /**
     * The repository key the stores of the application, or of one tenant, are encrypted under, held by
     * every given store once this returns.
     *
     * Taken from the stores, which hold it encrypted by the master key, else the key the same owner
     * already encrypts with, and generated when there is none. Each tenant has a key of its own, apart
     * from the application's and every other tenant's. Under a lease, so that two instances starting on
     * empty stores never make two.
     * @param stores - The stores, all of one owner.
     * @param tenantId - The tenant owning them, or undefined for the application.
     * @returns The key.
     * @throws When the stores hold more than one key between them.
     */
    async resolveRepositoryKey(stores: BackupTransportSupporting<'v2'>[], tenantId: string | undefined): Promise<BackupRepositoryKey> {
        const [firstId] = stores.map(s => this.keyIdsByStore.get(s.name));
        const known: BackupRepositoryKey | undefined = firstId == undefined ? undefined : this.keys.get(firstId);
        if (known != undefined && stores.every(s => this.keyIdsByStore.get(s.name) === known.id)) {
            return known;
        }
        const owner: string = this.resolveOwner(tenantId);
        // shared by the resources of this instance that ask at once, which would each read the key again
        const asked: string = [owner, ...stores.map(s => s.name).sort()].join('\n');
        const resolving: Promise<BackupRepositoryKey> = this.keysResolving.get(asked) ?? this.resolveRepositoryKeyUnderLease(stores, owner);
        this.keysResolving.set(asked, resolving);
        try {
            return await resolving;
        }
        finally {
            this.keysResolving.delete(asked);
        }
    }

    /**
     * Who a key belongs to, as {@link keyIdsByOwner} holds it.
     * @param tenantId - The tenant, or undefined for the application.
     * @returns The owner.
     */
    private resolveOwner(tenantId: string | undefined): string {
        // a tenant is named by a uuid, which no tenant shares with the application
        return tenantId == undefined ? 'application' : `tenant:${tenantId}`;
    }

    private async resolveRepositoryKeyUnderLease(stores: BackupTransportSupporting<'v2'>[], owner: string): Promise<BackupRepositoryKey> {
        const resolved: BackupRepositoryKey | undefined = await this.leaseService.withLease(
            { key: 'backup:repository-key', leaseInMs: Ms.MINUTE, mode: 'wait', acquireTimeoutInMs: Ms.MINUTE * 5 },
            async () => await this.withSessions(stores, async sessions => await this.resolveRepositoryKeyOn(stores, sessions, owner))
        );
        if (resolved == undefined) {
            throw new InternalError('Could not take the lease to resolve the repository key of the backups.');
        }
        return resolved;
    }

    private async resolveRepositoryKeyOn(
        stores: BackupTransportSupporting<'v2'>[],
        sessions: BackupTransportSessionInterface[],
        owner: string
    ): Promise<BackupRepositoryKey> {
        const held: string[][] = await Promise.all(sessions.map(async session => {
            const ids: string[] = [];
            for await (const page of session.findNames(KEYS_FOLDER)) {
                ids.push(...page);
            }
            return ids;
        }));
        const ids: string[] = [...new Set(held.flat())];
        if (ids.length > 1) {
            throw new InternalError(
                `A backup transport needs to hold the repository key of the others, or none: ${stores.map(s => s.name).join(', ')} `
                + `hold the keys ${ids.join(', ')} between them.`
            );
        }
        let key: BackupRepositoryKey;
        let document: RepositoryKeyDocument | undefined;
        const [id] = ids;
        const ownKeyId: string | undefined = this.keyIdsByOwner.get(owner);
        const ownKey: BackupRepositoryKey | undefined = ownKeyId == undefined ? undefined : this.keys.get(ownKeyId);
        if (id == undefined) {
            // stores the owner already holds a key on give theirs to one that holds none, so that one owner
            // encrypts under one key
            key = ownKey ?? { id: UUIDUtilities.generate(), idKey: randomBytes(32), dataKey: randomBytes(32) };
        }
        else {
            const holder: number = held.findIndex(h => h.includes(id));
            document = await this.readKeyDocument(stores[holder]?.name ?? '', this.getAt(sessions, holder), id);
            key = await this.unwrapKey(document);
        }
        const current: RepositoryKeyDocument = await this.wrapKey(key);
        // a key encrypted by a master key that was since rotated is encrypted again by the current one, so
        // the old master key can go
        const rewrapped: boolean = document?.wrapped.keyId !== current.wrapped.keyId;
        const stored: Buffer = Buffer.from(JsonUtilities.stringify(rewrapped ? current : document));
        await this.settleAll(sessions.map(async (session, i) => {
            if (rewrapped || held[i]?.includes(key.id) !== true) {
                await session.put(`${KEYS_FOLDER}/${key.id}`, Readable.from([stored]));
            }
        }));
        this.keys.set(key.id, key);
        if (!this.keyIdsByOwner.has(owner)) {
            this.keyIdsByOwner.set(owner, key.id);
        }
        for (const store of stores) {
            this.keyIdsByStore.set(store.name, key.id);
        }
        return key;
    }

    /**
     * The repository key a manifest names, as the store it is read from holds it.
     * @param store - The store.
     * @param session - A session with it.
     * @param id - The id of the key.
     * @returns The key.
     */
    async resolveKey(
        store: BackupTransportSupporting<'v2'>,
        session: BackupTransportSessionInterface,
        id: string
    ): Promise<BackupRepositoryKey> {
        const known: BackupRepositoryKey | undefined = this.keys.get(id);
        if (known != undefined) {
            return known;
        }
        const key: BackupRepositoryKey = await this.unwrapKey(await this.readKeyDocument(store.name, session, id));
        this.keys.set(id, key);
        return key;
    }

    private async readKeyDocument(storeName: string, session: BackupTransportSessionInterface, id: string): Promise<RepositoryKeyDocument> {
        const document: unknown = JSON.parse(await text(await session.get(`${KEYS_FOLDER}/${id}`, MAX_KEY_DOCUMENT_BYTES)));
        if (!this.isRepositoryKeyDocument(document) || document.id !== id) {
            throw new InternalError(`The repository key "${id}" held by the backup transport "${storeName}" is not readable.`);
        }
        return document;
    }

    /**
     * The bytes of a repository key, which a backup records for each resource it encrypts, encrypted by
     * the master key, so that a restore can tell whether it holds the master key before it fetches anything.
     * @param key - The key.
     * @returns Its id key and its data key.
     */
    resolveKeyBytes(key: BackupRepositoryKey): Buffer {
        return Buffer.concat([key.idKey, key.dataKey]);
    }

    private async wrapKey(key: BackupRepositoryKey): Promise<RepositoryKeyDocument> {
        const wrapped: EncryptionString = await this.encryptionService.masterEncrypt(this.resolveKeyBytes(key).toString('base64'));
        return { id: key.id, wrapped: EncryptionUtilities.encryptionStringToContent(wrapped) };
    }

    private async unwrapKey(document: RepositoryKeyDocument): Promise<BackupRepositoryKey> {
        const bytes: Buffer = Buffer.from(
            await this.encryptionService.masterDecrypt(EncryptionUtilities.contentToEncryptionString(document.wrapped)),
            'base64'
        );
        return this.toKey(document.id, bytes);
    }

    /**
     * The bytes of a repository key, as {@link resolveKeyBytes} gives them, read back into the key.
     * @param id - The id of the key.
     * @param bytes - The bytes.
     * @returns The key.
     * @throws When the bytes are not 64 long.
     */
    private toKey(id: string, bytes: Buffer): BackupRepositoryKey {
        if (bytes.length !== 64) {
            throw new InternalError(`The repository key "${id}" is ${bytes.length} bytes, where it needs to be 64.`);
        }
        return { id, idKey: bytes.subarray(0, 32), dataKey: bytes.subarray(32) };
    }

    private isRepositoryKeyDocument(value: unknown): value is RepositoryKeyDocument {
        if (typeof value !== 'object' || value == undefined || !('id' in value) || !('wrapped' in value)) {
            return false;
        }
        const { id, wrapped } = value;
        return typeof id === 'string' && typeof wrapped === 'object' && wrapped != undefined
            && 'strategyName' in wrapped && typeof wrapped.strategyName === 'string'
            && 'version' in wrapped && typeof wrapped.version === 'string'
            && 'keyId' in wrapped && typeof wrapped.keyId === 'string'
            && 'encryptedValue' in wrapped && typeof wrapped.encryptedValue === 'string';
    }

    private async storeChunk(
        chunk: Buffer,
        id: string,
        key: BackupRepositoryKey | undefined,
        sessions: BackupTransportSessionInterface[],
        indexes: BackupChunkIndex[],
        compressionLevel: number
    ): Promise<void> {
        const objectKey: string = this.resolveChunkKey(id, key);
        const held: Set<string>[] = await Promise.all(indexes.map(async index => await index.findStored([objectKey])));
        const missing: number[] = held.flatMap((h, i) => h.has(objectKey) ? [] : [i]);
        if (!missing.length) {
            return;
        }
        // sealed once for every store lacking it
        const sealed: Buffer = await BackupChunkUtilities.seal(chunk, id, key, compressionLevel);
        await this.settleAll(missing.map(async i => {
            await this.getAt(sessions, i).put(objectKey, Readable.from([sealed]));
            await this.getAt(indexes, i).noteStored({ key: objectKey, storedBytes: sealed.length });
        }));
    }

    /**
     * Waits for every given promise to settle, and fails with the first failure once they all have.
     *
     * Settled rather than raced, so that a put to one store failing leaves no put to another one still
     * running once the sessions close.
     * @param promises - The promises.
     */
    private async settleAll(promises: Promise<void>[]): Promise<void> {
        const failed: PromiseRejectedResult | undefined = (await Promise.allSettled(promises)).find(r => r.status === 'rejected');
        if (failed != undefined) {
            throw failed.reason;
        }
    }

    private async* fetchChunks(
        session: BackupTransportSessionInterface,
        entries: BackupManifestEntry[],
        key: BackupRepositoryKey | undefined
    ): AsyncGenerator<Buffer> {
        const fetch: (entry: BackupManifestEntry) => Promise<Buffer> = async entry => {
            const stored: Buffer = await buffer(await session.get(
                this.resolveChunkKey(entry.id, key),
                entry.length + BackupChunkUtilities.OVERHEAD_BYTES
            ));
            return await BackupChunkUtilities.open(stored, entry.id, key, entry.length);
        };
        const ahead: Promise<Buffer>[] = [];
        let next: number = 0;
        try {
            while (next < entries.length || ahead.length) {
                while (ahead.length < CHUNKS_FETCHED_AHEAD && next < entries.length) {
                    const fetched: Promise<Buffer> = fetch(this.getAt(entries, next++));
                    // handled when its turn comes; until then a failure must not count as unhandled. Not
                    // awaited, so that the chunks after it are fetched meanwhile
                    // eslint-disable-next-line promise/prefer-await-to-then
                    fetched.catch(() => undefined);
                    ahead.push(fetched);
                }
                const chunk: Promise<Buffer> | undefined = ahead.shift();
                if (chunk != undefined) {
                    yield await chunk;
                }
            }
        }
        finally {
            // nothing still reading once the session is closed
            await Promise.allSettled(ahead);
        }
    }

    private async findRecord(
        store: BackupTransportSupporting<'v2'>,
        session: BackupTransportSessionInterface,
        id: string
    ): Promise<string | undefined> {
        try {
            // as text: the record is handed back as it was stored, never parsed here
            return await text(await session.get(this.resolveRecordKey(id), MAX_RECORD_BYTES));
        }
        catch (error) {
            if (!(error instanceof BackupKeyNotFoundError)) {
                throw error;
            }
        }
        for await (const page of session.findKeys(`${BACKUPS_FOLDER}/${id}/`)) {
            if (page.length) {
                // what a backup interrupted before its record leaves: the record is written last
                this.logger.warn(`Could not find the record needed to resolve the backup "${id}" in the transport "${store.name}"`);
                return undefined;
            }
        }
        return undefined;
    }

    private resolveGearTable(key: BackupRepositoryKey | undefined): Int32Array {
        const known: Int32Array | undefined = this.gearTables.get(key?.id ?? '');
        if (known != undefined) {
            return known;
        }
        const table: Int32Array = BackupChunkingUtilities.resolveGearTable(key?.idKey);
        this.gearTables.set(key?.id ?? '', table);
        return table;
    }

    /**
     * The key a chunk is stored under.
     * @param id - The id of the chunk.
     * @param key - The repository key it is encrypted with, or undefined for an unencrypted one.
     * @returns The key.
     */
    resolveChunkKey(id: string, key: BackupRepositoryKey | undefined): string {
        // a folder per first two digits, so that no folder of a store keeping files holds every chunk
        return `${key == undefined ? PLAIN_CHUNKS_FOLDER : CHUNKS_FOLDER}/${id.slice(0, 2)}/${id}`;
    }

    private resolveResourceKey(backup: BackupEntity, resource: BackupResourceEntity): string {
        return `${BACKUPS_FOLDER}/${backup.id}/${resource.id}`;
    }

    private resolveRecordKey(backupId: string): string {
        return `${BACKUPS_FOLDER}/${backupId}/${RECORD_NAME}`;
    }

    private async* prepend(header: Buffer, data: AsyncIterable<unknown>): AsyncGenerator<Buffer> {
        yield header;
        for await (const piece of data) {
            yield Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece));
        }
    }

    private async withSessions<T>(
        stores: BackupTransportSupporting<'v2'>[],
        work: (sessions: BackupTransportSessionInterface[]) => Promise<T>
    ): Promise<T> {
        const sessions: BackupTransportSessionInterface[] = [];
        try {
            for (const store of stores) {
                sessions.push(await store.openSession());
            }
            return await work(sessions);
        }
        finally {
            await Promise.all(sessions.map(async session => await session.close()));
        }
    }

    private closingWith(data: Readable, store: BackupTransportSupporting<'v2'>, session: BackupTransportSessionInterface): Readable {
        // the session belongs to the stream from here on, until it is read or destroyed
        data.once('close', () => this.closeSession(store, session));
        return data;
    }

    private closeSession(store: BackupTransportSupporting<'v2'>, session: BackupTransportSessionInterface): void {
        // what was fetched is in hand by now: a session that fails to close loses nothing of it
        // not awaited: whoever closes it goes on at once
        void (async (): Promise<void> => {
            try {
                await session.close();
            }
            catch (error) {
                const message: string = error instanceof Error ? error.message : String(error);
                this.logger.warn(`Could not close a session of the transport "${store.name}": ${message}`);
            }
        })();
    }

    private getAt<T>(items: T[], index: number): T {
        const item: T | undefined = items[index];
        if (item == undefined) {
            throw new InternalError(`Nothing is at ${index} of ${items.length}.`);
        }
        return item;
    }
}