import { createHash, Hash } from 'node:crypto';
import { Dirent } from 'node:fs';
import { Readable, Transform, TransformCallback } from 'node:stream';
import { buffer } from 'node:stream/consumers';
import { pipeline } from 'node:stream/promises';

import { ZibriApplication } from '../application/application';
import { AuthServiceInterface } from '../auth/auth-service.interface';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Repository } from '../data-source/repository/repository';
import { NoActiveTenantError } from '../data-source/tenancy/no-active-tenant.error';
import { RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { getRegisteredProvidersOfVariant } from '../di/get-registered-providers-of-variant.function';
import { inject } from '../di/inject.function';
import { DiVariants } from '../di/models/di-variant.model';
import { BadRequestError } from '../error-handling/errors/bad-request.error';
import { ConflictError } from '../error-handling/errors/conflict.error';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { MimeType } from '../http/mime-type.enum';
import { $ts } from '../localization/translate.function';
import { type LoggerInterface } from '../logging/logger.interface';
import { resolveStructuredBodyMetadata } from '../routing/resolve-body-metadata.function';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { type FsPath, FsUtilities } from '../utilities/fs.utilities';
import { JsonUtilities } from '../utilities/json.utilities';
import { Ms } from '../utilities/ms';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';
import { ValidationServiceInterface } from '../validation/validation-service.interface';
import { FileCleanupCronJob } from './file-cleanup.cron-job';
import { FileHashMismatchError } from './file-hash-mismatch.error';
import { FileRecord, FileRecordCreateData } from './file-record.model';
import { FileServiceInterface } from './file-service.interface';
import { StoreFileData } from './store-file-data.model';
import { FileStoreEntry } from './stores/file-store-entry.model';
import { FileStoreInterface, isFileStore } from './stores/file-store.interface';
import { AnyTenantFileStoreKind } from './tenant/tenant-file-store-kind.interface';
import { TenantFileStoreOptions } from './tenant/tenant-file-store-options.model';
import { TenantFileStore, TenantFileStoreCreateData } from './tenant/tenant-file-store.model';
import { TENANT_FILE_STORE_NAME_PREFIX, TenantRowFileStore } from './tenant/tenant-row.file-store';

// how long bytes no row references are kept after they were last written. A store writes the bytes before the row,
// in the caller's transaction, so bytes a transaction still running is about to reference look exactly like those of
// one rolled back: the time since they were written is all that tells them apart
const UNREFERENCED_GRACE_IN_MS: number = Ms.DAY;
// how long a staged file goes unwritten before it counts as left behind by a process that went down mid-store
const STAGED_FILE_LIFETIME_IN_MS: number = Ms.DAY;

/**
 * A store and the name the rows of the files kept in it record.
 */
type ResolvedFileStore = {
    /**
     * The name the rows record: the store's own, or the prefixed id of a tenant's.
     */
    name: string,
    /**
     * The store.
     */
    store: FileStoreInterface
};

/**
 * The bytes of a file about to be stored, hashed.
 */
type StagedFileContent = {
    /**
     * The SHA-256 of the bytes, in hex.
     */
    sha256: string,
    /**
     * How many bytes there are.
     */
    size: number,
    /**
     * Opens the bytes for reading, once.
     */
    open: () => Readable,
    /**
     * Deletes what was staged.
     */
    dispose: () => Promise<void>
};

/**
 * Default file service of Zibri: each file a row of `FileRecord`, its bytes kept once per content in the store.
 */
@Injectable({ register: 'onUse' })
export class FileService implements FileServiceInterface, OnAppInit {
    private readonly applicationStores: Map<string, FileStoreInterface> = new Map();
    private tenantStoresDeclared: boolean = false;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.FILE_STAGING_FOLDER)
        private readonly tempFolder: FsPath
    ) {}

    // read when used rather than injected, so that an application without the entities is told to declare them by
    // onAppInit, instead of failing on a repository token while this is built
    private get recordRepository(): Repository<FileRecord, FileRecordCreateData> {
        return inject(repositoryTokenFor(FileRecord));
    }

    private get tenantStoreRepository(): Repository<TenantFileStore> {
        return inject(repositoryTokenFor(TenantFileStore));
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppInit(app: ZibriApplication): Promise<void> {
        this.tenantStoresDeclared = app.options.dataSources.some(d => inject(d).entities.includes(TenantFileStore));
        for (const provider of getRegisteredProvidersOfVariant(DiVariants.FILE_STORE)) {
            const store: unknown = inject(provider.token);
            if (!isFileStore(store)) {
                throw new InternalError(`The file store ${String(provider.token)} needs to implement FileStoreInterface.`);
            }
            // a tenant's store is told apart by the prefix alone
            if (store.name.startsWith(TENANT_FILE_STORE_NAME_PREFIX)) {
                throw new InternalError(
                    `The name of the file store "${store.name}" may not start with "${TENANT_FILE_STORE_NAME_PREFIX}".`
                );
            }
            if (this.applicationStores.has(store.name)) {
                throw new InternalError(`Two file stores are named "${store.name}". A row names its store by the name alone.`);
            }
            this.applicationStores.set(store.name, store);
        }
        if (!this.applicationStores.size && !this.tenantStoresDeclared) {
            return;
        }
        validateEntitiesRegistered(FileService.name, app, FileRecord);
        if (!app.options.cronJobs.includes(FileCleanupCronJob)) {
            app.options.cronJobs.push(FileCleanupCronJob);
        }
        await this.deleteLeftOverStagedFiles();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async store(data: StoreFileData, transaction?: RepositoryTransaction): Promise<FileRecord> {
        const tenantId: string | undefined = this.tenantService.getActiveTenantId();
        if (tenantId == undefined) {
            throw new NoActiveTenantError(FileRecord);
        }
        const target: ResolvedFileStore = await this.resolveStoreToWrite(data.store);
        const content: StagedFileContent = await this.stage(data.data);
        try {
            // by its content, so that the same bytes in the same store and tenant are kept once
            const key: string = `${tenantId}/${content.sha256.slice(0, 2)}/${content.sha256}`;
            // written again when the key holds them already: a write is what tells a delete and the cleanup that the
            // bytes are about to be referenced, by a row of a transaction that has not committed yet
            await target.store.put(key, content.open());
            return await this.recordRepository.create(
                {
                    name: data.name,
                    mimeType: data.mimeType,
                    size: content.size,
                    sha256: content.sha256,
                    storeName: target.name,
                    key,
                    createdBy: data.createdBy ?? await this.findCurrentUserId() ?? null
                },
                { transaction }
            );
        }
        finally {
            await content.dispose();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async copy(id: string, store: string, transaction?: RepositoryTransaction): Promise<FileRecord> {
        const file: FileRecord = await this.recordRepository.findById(id, { transaction });
        const source: FileStoreInterface = await this.resolveStoreOfFile(file);
        const target: ResolvedFileStore = await this.resolveStoreToWrite(store);
        // staged, so that bytes that changed in the store are refused before the copy holds them
        const content: StagedFileContent = await this.stage(await source.get(file.key, file.size));
        try {
            this.validateHash(file, content.sha256);
            // under the key of the file, which is made of its tenant and its content, as the copy's are the same
            await target.store.put(file.key, content.open());
            return await this.recordRepository.create(
                {
                    name: file.name,
                    mimeType: file.mimeType,
                    size: file.size,
                    sha256: file.sha256,
                    storeName: target.name,
                    key: file.key,
                    createdBy: file.createdBy ?? null
                },
                { transaction }
            );
        }
        finally {
            await content.dispose();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findFile(id: string): Promise<FileRecord | undefined> {
        return await this.recordRepository.findById(id, { required: false });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findFiles(ids: string[], transaction?: RepositoryTransaction): Promise<FileRecord[]> {
        return ids.length ? await this.recordRepository.findAll({ where: { id: { oneOf: ids } }, limit: 'all', transaction }) : [];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async read(id: string): Promise<Buffer> {
        const file: FileRecord = await this.recordRepository.findById(id);
        const store: FileStoreInterface = await this.resolveStoreOfFile(file);
        // no larger than it was stored: bytes that have grown since are refused while they arrive
        const content: Buffer = await buffer(await store.get(file.key, file.size));
        this.validateHash(file, createHash('sha256').update(content)
            .digest('hex'));
        return content;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async readStream(id: string): Promise<Readable> {
        const file: FileRecord = await this.recordRepository.findById(id);
        const store: FileStoreInterface = await this.resolveStoreOfFile(file);
        const data: Readable = await store.get(file.key, file.size);
        const hash: Hash = createHash('sha256');
        const checked: Transform = new Transform({
            transform: (chunk: Buffer, _encoding: BufferEncoding, next: TransformCallback): void => {
                hash.update(chunk);
                next(undefined, chunk);
            },
            // at the end, as the bytes are handed over while they arrive: whoever reads them learns they were
            // refused by the stream failing rather than ending
            flush: (next: TransformCallback): void => {
                try {
                    this.validateHash(file, hash.digest('hex'));
                    next();
                }
                catch (error) {
                    next(error instanceof Error ? error : new InternalError(String(error)));
                }
            }
        });
        // wired by hand rather than with pipeline, whose promise nobody would wait for: a failing store fails the
        // stream that was handed out, and a reader stopping early stops the store
        data.once('error', error => checked.destroy(error));
        checked.once('close', () => {
            if (!data.readableEnded) {
                data.destroy();
            }
        });
        data.pipe(checked);
        return checked;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async delete(id: string, transaction?: RepositoryTransaction): Promise<void> {
        const file: FileRecord = await this.recordRepository.findById(id, { transaction });
        await this.recordRepository.deleteById(id, { transaction });
        const deleteContent: () => Promise<void> = async () => await this.deleteContentOfDeleted(file);
        if (transaction == undefined) {
            await deleteContent();
            return;
        }
        // only once the row is really gone: deleted with a transaction rolled back, the row would name bytes that are not
        transaction.afterCommit(deleteContent);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteRemovedFiles(ids: string[]): Promise<void> {
        if (!ids.length) {
            return;
        }
        // across tenants, as a write such as the deletion of a tenant or a sweep of expired rows runs in none
        const files: FileRecord[] = await this.recordRepository
            .findAll({ where: { id: { oneOf: ids } }, acrossTenants: true, limit: 'all' });
        if (!files.length) {
            return;
        }
        await this.recordRepository.deleteAll({ id: { oneOf: files.map(f => f.id) } }, { acrossTenants: true });
        await PromiseUtilities.allChunked(files, async file => await this.deleteContentOfDeleted(file));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteUnreferencedFiles(): Promise<number> {
        let deleted: number = 0;
        for (const store of this.applicationStores.values()) {
            deleted += await this.deleteUnreferencedIn({ name: store.name, store }, '');
        }
        if (!this.tenantStoresDeclared) {
            return deleted;
        }
        const rows: TenantFileStore[] = await this.tenantStoreRepository.findAll({ acrossTenants: true, limit: 'all' });
        for (const row of rows) {
            try {
                deleted += await this.deleteUnreferencedIn(this.toTenantStore(row), `${row.tenantId}/`);
            }
            catch (error) {
                // a tenant's storage it cannot reach right now leaves the others to clean up
                this.logger.warn(
                    `Could not clean up the file store "${row.name}" of the tenant ${row.tenantId}: `
                    + (error instanceof Error ? error.message : String(error))
                );
            }
        }
        return deleted;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async createTenantFileStore(tenantId: string, data: TenantFileStoreCreateData): Promise<TenantFileStore> {
        this.validateTenantStoresDeclared();
        await this.validateTenantStore(data);
        const { secret, ...settings } = data;
        const created: TenantFileStore = await this.tenantService.runAs(tenantId, async () => {
            const row: TenantFileStore = await this.tenantStoreRepository.create({
                ...settings,
                secret: JsonUtilities.stringify(secret)
            });
            return await this.tenantStoreRepository.findById(row.id);
        });
        // written and deleted at once, so that a wrong address, bucket or secret fails here rather than at the
        // first file, whose failing nobody may be watching
        const store: TenantRowFileStore = new TenantRowFileStore(created, inject(ZIBRI_DI_TOKENS.FILE_TENANT_STORE_OPTIONS));
        try {
            const probe: string = `${tenantId}/probe-${UUIDUtilities.generate()}`;
            await store.put(probe, Readable.from([Buffer.from('zibri')]));
            await store.delete([probe]);
        }
        catch (error) {
            await this.tenantService.runAs(tenantId, async () => await this.tenantStoreRepository.deleteById(created.id));
            throw new BadRequestError(
                $ts`The file store ${data.name} could not be written to: ${error instanceof Error ? error.message : String(error)}`
            );
        }
        return created;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findTenantFileStores(tenantId: string): Promise<TenantFileStore[]> {
        this.validateTenantStoresDeclared();
        return await this.tenantService.runAs(tenantId, async () => await this.tenantStoreRepository.findAll({ limit: 'all' }));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteTenantFileStore(tenantId: string, id: string): Promise<void> {
        this.validateTenantStoresDeclared();
        await this.tenantService.runAs(tenantId, async () => {
            // the tenant's own first: a store of another tenant is none of its business
            await this.tenantStoreRepository.findById(id);
            // a file kept in it would lose the one place its bytes are
            if (await this.recordRepository.exists({ where: { storeName: `${TENANT_FILE_STORE_NAME_PREFIX}${id}` } })) {
                throw new ConflictError($ts`Files are kept in the file store. Delete those first.`);
            }
            await this.tenantStoreRepository.deleteById(id);
        });
    }

    /**
     * Resolves the store a file of the current tenant is written to: the tenant's own of that name, else the
     * application's.
     * @param name - The name of the store.
     * @returns The store.
     */
    private async resolveStoreToWrite(name: string): Promise<ResolvedFileStore> {
        if (this.tenantStoresDeclared) {
            const row: TenantFileStore | undefined = await this.tenantStoreRepository.findOne({ where: { name }, required: false });
            if (row != undefined) {
                return this.toTenantStore(row);
            }
        }
        const store: FileStoreInterface | undefined = this.applicationStores.get(name);
        if (store == undefined) {
            throw new InternalError(`No file store is named "${name}". Register one with @FileStore().`);
        }
        return { name: store.name, store };
    }

    /**
     * Resolves the store the bytes of a file are kept in, the one its row names.
     * @param file - The row of the file.
     * @returns The store.
     */
    private async resolveStoreOfFile(file: FileRecord): Promise<FileStoreInterface> {
        if (file.storeName.startsWith(TENANT_FILE_STORE_NAME_PREFIX)) {
            const id: string = file.storeName.slice(TENANT_FILE_STORE_NAME_PREFIX.length);
            // across tenants, since the row is found by its id, and the delete of a file goes on after its commit
            const row: TenantFileStore | undefined = this.tenantStoresDeclared
                ? await this.tenantStoreRepository.findById(id, { required: false, acrossTenants: true })
                : undefined;
            if (row == undefined) {
                throw new InternalError(
                    `The file "${file.name}" (${file.id}) is kept in the file store ${id} of its tenant, which does not exist.`
                );
            }
            return this.toTenantStore(row).store;
        }
        const store: FileStoreInterface | undefined = this.applicationStores.get(file.storeName);
        if (store == undefined) {
            throw new InternalError(
                `The file "${file.name}" (${file.id}) is kept in the file store "${file.storeName}", which is not registered.`
            );
        }
        return store;
    }

    private toTenantStore(row: TenantFileStore): ResolvedFileStore {
        const store: TenantRowFileStore = new TenantRowFileStore(row, inject(ZIBRI_DI_TOKENS.FILE_TENANT_STORE_OPTIONS));
        return { name: store.name, store };
    }

    /**
     * Hashes the bytes of a file, and stages a stream on this instance's disk, so that it is read once and never
     * held in memory whole.
     * @param data - The bytes.
     * @returns The bytes, hashed.
     */
    private async stage(data: Buffer | Readable): Promise<StagedFileContent> {
        if (Buffer.isBuffer(data)) {
            return {
                sha256: createHash('sha256').update(data)
                    .digest('hex'),
                size: data.length,
                open: () => Readable.from([data]),
                dispose: async () => await Promise.resolve()
            };
        }
        // the key is the hash, which is known only once the stream ended, and a store cannot rename what it holds
        await FsUtilities.mkdir(this.tempFolder);
        const staged: FsPath = FsUtilities.getPath(this.tempFolder, UUIDUtilities.generate());
        const hash: Hash = createHash('sha256');
        let size: number = 0;
        const hashing: Transform = new Transform({
            transform: (chunk: Buffer, _encoding: BufferEncoding, next: TransformCallback): void => {
                hash.update(chunk);
                size += chunk.length;
                next(undefined, chunk);
            }
        });
        try {
            await pipeline(data, hashing, FsUtilities.createWriteStream(staged));
        }
        catch (error) {
            await FsUtilities.rm(staged);
            throw error;
        }
        return {
            sha256: hash.digest('hex'),
            size,
            open: () => FsUtilities.createReadStream(staged),
            dispose: async () => await FsUtilities.rm(staged)
        };
    }

    /**
     * Deletes the bytes of a deleted file as {@link deleteContentIfUnreferenced} does, logging what fails.
     * @param file - The row of the deleted file.
     */
    private async deleteContentOfDeleted(file: FileRecord): Promise<void> {
        try {
            await this.deleteContentIfUnreferenced(file);
        }
        catch (error) {
            // the row is gone either way, and bytes no row references are what the cleanup deletes
            this.logger.warn(
                `Could not delete the bytes of the file "${file.name}" (${file.id}) from the file store "${file.storeName}", `
                + `which FileCleanupCronJob does later: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    /**
     * Deletes the bytes of a deleted file when no other row references them and they were not written for a day.
     * Bytes written since are left to the cleanup, as a store of the same content may be about to reference them.
     * @param file - The row of the deleted file.
     */
    private async deleteContentIfUnreferenced(file: FileRecord): Promise<void> {
        // across tenants, since the key holds the tenant, and this may run after the commit
        if (await this.recordRepository.exists({ where: { storeName: file.storeName, key: file.key }, acrossTenants: true })) {
            return;
        }
        const store: FileStoreInterface = await this.resolveStoreOfFile(file);
        const entry: FileStoreEntry | undefined = await store.findEntry(file.key);
        if (entry != undefined && this.isPastGrace(entry)) {
            await store.delete([file.key]);
        }
    }

    /**
     * Deletes the keys under a prefix of a store that no row references and that were not written for a day.
     * @param target - The store, and the name the rows record of it.
     * @param prefix - The prefix the keys are under.
     * @returns How many keys were deleted.
     */
    private async deleteUnreferencedIn(target: ResolvedFileStore, prefix: string): Promise<number> {
        const unreferenced: string[] = [];
        for await (const keys of target.store.findKeys(prefix)) {
            // one read per page rather than per key
            const referenced: Set<string> = new Set((await this.recordRepository.findAll({
                where: { storeName: target.name, key: { oneOf: keys } },
                acrossTenants: true,
                limit: 'all'
            })).map(f => f.key));
            const candidates: string[] = keys.filter(key => !referenced.has(key));
            const entries: (FileStoreEntry | undefined)[] = await PromiseUtilities.allChunked(
                candidates,
                async key => await target.store.findEntry(key)
            );
            unreferenced.push(...candidates.filter((_, i) => {
                const entry: FileStoreEntry | undefined = entries[i];
                return entry != undefined && this.isPastGrace(entry);
            }));
        }
        // once the listing is done, so that no page of it shifts under the deletes
        if (unreferenced.length) {
            await target.store.delete(unreferenced);
        }
        return unreferenced.length;
    }

    private isPastGrace(entry: FileStoreEntry): boolean {
        return Date.now() - entry.modifiedAt.getTime() >= UNREFERENCED_GRACE_IN_MS;
    }

    private validateHash(file: FileRecord, sha256: string): void {
        if (sha256 !== file.sha256) {
            throw new FileHashMismatchError(file);
        }
    }

    /**
     * Finds the id of the user of the current request.
     * @returns The id, or undefined outside a request or for a request of no user.
     */
    private async findCurrentUserId(): Promise<string | undefined> {
        const context: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        if (context == undefined) {
            return undefined;
        }
        const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
        const user: CurrentUser | undefined = await authService.resolveCurrentUser(context, authService.strategies, false);
        return user?.id;
    }

    /**
     * Deletes the files a store staged that a process going down left behind.
     */
    private async deleteLeftOverStagedFiles(): Promise<void> {
        if (!await FsUtilities.exists(this.tempFolder)) {
            return;
        }
        const cutoff: number = Date.now() - STAGED_FILE_LIFETIME_IN_MS;
        const entries: Dirent[] = await FsUtilities.readdir(this.tempFolder);
        await Promise.all(entries.map(async entry => {
            const file: FsPath = FsUtilities.getPath(this.tempFolder, entry.name);
            try {
                if ((await FsUtilities.stat(file)).mtimeMs < cutoff) {
                    await FsUtilities.rm(file);
                }
            }
            catch {
                // gone already, deleted by another instance sharing the folder
            }
        }));
    }

    private validateTenantStoresDeclared(): void {
        if (!this.tenantStoresDeclared) {
            throw new InternalError(
                'The file stores of tenants are stored in TenantFileStore, which needs to be declared beside FileRecord.'
            );
        }
    }

    /**
     * Validates what a tenant configures as a file store: of a kind the application lists, its settings and its
     * secret as the models of the kind describe them, and as the kind checks them beyond.
     * @param data - What the tenant configures.
     * @throws {BadRequestError} When it is not.
     */
    private async validateTenantStore(data: TenantFileStoreCreateData): Promise<void> {
        const options: TenantFileStoreOptions = inject(ZIBRI_DI_TOKENS.FILE_TENANT_STORE_OPTIONS);
        const kind: AnyTenantFileStoreKind | undefined = options.kinds.find(k => k.name === data.kind);
        if (kind == undefined) {
            throw new BadRequestError($ts`A file store needs to be one of ${options.kinds.map(k => k.name).join(', ')}.`);
        }
        // read the way a json body of the model is, since it is what a tenant sends as one
        const validation: ValidationServiceInterface = inject(ZIBRI_DI_TOKENS.VALIDATION_SERVICE);
        await validation.validateBody(
            data.settings,
            resolveStructuredBodyMetadata({ type: MimeType.JSON, modelClass: kind.settingsModel }, 0)
        );
        await validation.validateBody(
            data.secret,
            resolveStructuredBodyMetadata({ type: MimeType.JSON, modelClass: kind.secretModel }, 0)
        );
        kind.validateSettings?.(data.settings, data.secret, { allowPrivateNetworks: options.allowPrivateNetworks });
    }
}