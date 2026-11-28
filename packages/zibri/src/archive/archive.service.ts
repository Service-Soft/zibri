import { Readable, Writable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

import { type ZibriApplication } from '../application/application';
import { ChainVerification } from '../data-source/chain/chain-verification.model';
import { GroupKeysOf } from '../data-source/models/aggregate.model';
import { Where } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository/repository';
import { TenantUtilities } from '../data-source/tenancy/tenant.utilities';
import { Transaction } from '../data-source/transaction/transaction.model';
import { TransactionUtilities } from '../data-source/transaction/transaction.utilities';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { type EntityOrder } from '../entity/models/entity-order.model';
import { EntityTenant } from '../entity/models/entity-tenant.model';
import { ArchivedEntityUtilities } from '../entity/utilities/archived-entity.utilities';
import { NotFoundError } from '../error-handling/errors/not-found.error';
import { InternalError } from '../error-handling/internal-error.model';
import { FileHashMismatchError } from '../file/file-hash-mismatch.error';
import { FilePropertyUtilities, StoredFileProperty } from '../file/file-property.utilities';
import { FileRecord } from '../file/file-record.model';
import { FileServiceInterface } from '../file/file-service.interface';
import { OnAppInit } from '../global/on-app-init.interface';
import { Timezone } from '../localization/models/timezone.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { Newable } from '../types/newable.type';
import { type FsPath, FsUtilities } from '../utilities/fs.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { UUIDUtilities } from '../utilities/uuid.utilities';
import { ArchiveMetadata } from './archive-options.model';
import { ArchiveData, ArchiveFindDueOptions, ArchiveServiceInterface, ArchiveVerificationOptions } from './archive-service.interface';
import { ArchivedChainVerification, ArchivedFileProblem, ArchivedFileProblemReason, ArchiveVerification } from './archive-verification.model';
import { ArchiveUtilities } from './archive.utilities';
import { ArchivedFile } from './archived-file.model';
import { BaseArchivedEntity } from './base-archived-entity.model';

/**
 * How many rows are read at once while the archive is checked or pruned.
 */
const PAGE_SIZE: number = 500;

/**
 * A file, or a copy of it, to check against what its row recorded.
 */
type FileCheck = {
    /**
     * The row.
     */
    row: BaseArchivedEntity,
    /**
     * The file, as the row recorded it.
     */
    file: ArchivedFile,
    /**
     * The id of the file or of the copy.
     */
    id: string
};

/**
 * Default archive service of Zibri: the chains of the chain service, and the files of the file service.
 */
@Injectable({ register: 'onUse' })
export class ArchiveService implements ArchiveServiceInterface, OnAppInit {
    /**
     * The archived entities the data sources of the application declare.
     */
    private entities: Newable<BaseArchivedEntity>[] = [];

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.FILE_STAGING_FOLDER)
        private readonly stagingFolder: FsPath
    ) {}

    // read when used, as an application archiving rows without files registers no file store
    private get fileService(): FileServiceInterface {
        return inject(ZIBRI_DI_TOKENS.FILE_SERVICE);
    }

    private get tenantService(): TenantServiceInterface {
        return inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        const entities: Set<Newable<BaseEntity>> = new Set(app.options.dataSources.flatMap(d => inject(d).entities));
        this.entities = [...entities].filter(e => ArchivedEntityUtilities.isArchived(e));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveArchiveData(
        entityClass: Newable<BaseArchivedEntity>,
        rows: object[],
        transaction: Transaction | undefined
    ): Promise<ArchiveData[]> {
        const metadata: ArchiveMetadata = this.getMetadata(entityClass);
        const timezone: Timezone = inject(ZIBRI_DI_TOKENS.LOCALIZE_OPTIONS).defaultTimezone;
        const fileProperties: StoredFileProperty[] = FilePropertyUtilities.resolveStoredFileProperties(entityClass);
        const createdAt: Date = new Date();
        const res: ArchiveData[] = [];
        // one after the other, as the copies of one transaction are written over one connection
        for (const row of rows) {
            const ids: string[] = FilePropertyUtilities.resolveFileIds(row, fileProperties);
            const archivedFiles: ArchivedFile[] = ids.length
                ? await this.runInTenantOf(
                    entityClass,
                    row,
                    async () => await this.resolveArchivedFiles(entityClass, metadata, ids, transaction)
                )
                : [];
            res.push({ retainUntil: this.resolveRetainUntil(entityClass, metadata, row, timezone, createdAt), archivedFiles });
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveVerification(options?: ArchiveVerificationOptions): Promise<ArchiveVerification> {
        const chains: ArchivedChainVerification[] = [];
        const fileProblems: ArchivedFileProblem[] = [];
        let checkedFiles: number = 0;
        for (const entityClass of options?.entityClass == undefined ? this.entities : [options.entityClass]) {
            const tenants: (string | undefined)[] = options?.tenantId == undefined
                ? await this.findChainTenants(entityClass)
                : [options.tenantId];
            for (const tenantId of tenants) {
                const verification: ChainVerification = await inject(ZIBRI_DI_TOKENS.CHAIN_SERVICE)
                    .resolveChainVerification(entityClass, tenantId);
                chains.push({ entityName: entityClass.name, tenantId, verification });
                checkedFiles += await this.validateFilesOfChain(entityClass, tenantId, fileProblems);
            }
        }
        return {
            intact: chains.every(chain => chain.verification.intact) && !fileProblems.length,
            chains,
            fileProblems,
            checkedFiles
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findDue<T extends BaseArchivedEntity>(entityClass: Newable<T>, options?: ArchiveFindDueOptions): Promise<T[]> {
        const repository: Repository<T> = inject(repositoryTokenFor(entityClass));
        // `retainUntil` of every archived entity, which `EntityOrder<T>` cannot be built from without knowing T
        const order: EntityOrder<T> = { retainUntil: 'ASC' } as EntityOrder<T>;
        return await repository.findAll({
            where: this.whereDue(new Date()),
            order,
            limit: options?.limit ?? 100,
            acrossTenants: options?.acrossTenants
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async prune(entityClass?: Newable<BaseArchivedEntity>): Promise<number> {
        let removed: number = 0;
        for (const entity of entityClass == undefined ? this.entities : [entityClass]) {
            const repository: Repository<BaseArchivedEntity> = inject(repositoryTokenFor(entity));
            for (;;) {
                // oldest first, so that the rows at the old end of each chain move its start along
                const due: BaseArchivedEntity[] = await repository.findAll({
                    where: this.whereDue(new Date()),
                    order: { chainSequence: 'ASC' },
                    limit: PAGE_SIZE,
                    acrossTenants: true,
                    unscoped: true
                });
                if (!due.length) {
                    break;
                }
                // in a transaction, so that the rows go together with what the chains record of them
                removed += await TransactionUtilities.runAndCommit(
                    await repository.dataSource.startTransaction(),
                    async transaction => await repository.deleteAll(
                        { id: { oneOf: due.map(row => row.id) } },
                        { acrossTenants: true, unscoped: true, transaction }
                    )
                );
                if (due.length < PAGE_SIZE) {
                    break;
                }
            }
        }
        return removed;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async readFile(row: BaseArchivedEntity, fileId: string): Promise<Readable> {
        const file: ArchivedFile | undefined = row.archivedFiles.find(f => f.id === fileId || f.copies.includes(fileId));
        const candidates: string[] = file == undefined ? [fileId] : [...new Set([fileId, file.id, ...file.copies])];
        let failure: unknown;
        for (const id of candidates) {
            try {
                return await this.readChecked(id);
            }
            catch (error) {
                failure = error;
                this.logger.warn(
                    `Could not read the file ${id} of the row ${row.id}, so another copy is read: `
                    + (error instanceof Error ? error.message : String(error))
                );
            }
        }
        throw failure instanceof Error ? failure : new InternalError(`Could not read the file ${fileId} of the row ${row.id}.`);
    }

    /**
     * Gets what `@Archive` declares of an entity.
     * @param entityClass - The entity.
     * @returns Its archive.
     * @throws An InternalError for an entity that is not archived.
     */
    private getMetadata(entityClass: Newable<BaseArchivedEntity>): ArchiveMetadata {
        const metadata: ArchiveMetadata | undefined = ArchiveUtilities.findMetadata(entityClass);
        if (metadata == undefined) {
            throw new InternalError(`${entityClass.name} is not archived. Declare it with @Archive().`);
        }
        return metadata;
    }

    /**
     * Resolves when the retention of a row about to be created ends.
     * @param entityClass - The archived entity.
     * @param metadata - Its archive.
     * @param row - The row.
     * @param timezone - The time zone whose calendar the retention is counted on.
     * @param createdAt - When the row is created.
     * @returns The `retainUntil` the row is created with, or the end of its retention.
     * @throws An InternalError when the date property of the row holds no date.
     */
    private resolveRetainUntil(
        entityClass: Newable<BaseArchivedEntity>,
        metadata: ArchiveMetadata,
        row: object,
        timezone: Timezone,
        createdAt: Date
    ): Date {
        const given: unknown = Reflect.get(row, 'retainUntil');
        if (given instanceof Date) {
            return given;
        }
        const date: unknown = metadata.dateProperty == undefined ? createdAt : Reflect.get(row, metadata.dateProperty);
        if (!(date instanceof Date)) {
            throw new InternalError(
                `${entityClass.name}.${metadata.dateProperty} needs to be a date, since the retention of the row is counted from it.`
            );
        }
        return ArchiveUtilities.resolveRetainUntil(date, metadata, timezone);
    }

    /**
     * Resolves what a row records of its files, copying each into the stores the archive names.
     * @param entityClass - The archived entity.
     * @param metadata - Its archive.
     * @param ids - The ids of the files the row holds.
     * @param transaction - The transaction the row is created in, which may hold the rows of its files.
     * @returns Each file, with its SHA-256 and the ids of its copies.
     * @throws An InternalError for a file that does not exist.
     */
    private async resolveArchivedFiles(
        entityClass: Newable<BaseArchivedEntity>,
        metadata: ArchiveMetadata,
        ids: string[],
        transaction: Transaction | undefined
    ): Promise<ArchivedFile[]> {
        const records: FileRecord[] = await this.fileService.findFiles(ids, transaction);
        const res: ArchivedFile[] = [];
        for (const id of ids) {
            const record: FileRecord | undefined = records.find(r => r.id === id);
            if (record == undefined) {
                throw new InternalError(
                    `A row of ${entityClass.name} holds the file "${id}", which does not exist, so it is not archived.`
                );
            }
            const copies: string[] = [];
            for (const store of metadata.copies) {
                copies.push((await this.fileService.copy(id, store, transaction)).id);
            }
            // a plain object, which its chain hashes alike however a store hands it back
            res.push({ id, sha256: record.sha256, copies });
        }
        return res;
    }

    /**
     * Runs work in the tenant of a row, which the files it holds belong to.
     * @param entityClass - The entity of the row.
     * @param row - The row.
     * @param work - The work.
     * @returns What the work resolves.
     */
    private async runInTenantOf<R>(entityClass: Newable<BaseEntity>, row: object, work: () => Promise<R>): Promise<R> {
        const tenantId: string | undefined = TenantUtilities.resolveTenantOf(row, entityClass);
        return tenantId == undefined || tenantId === this.tenantService.getActiveTenantId()
            ? await work()
            : await this.tenantService.runAs(tenantId, work);
    }

    /**
     * Finds the tenants whose rows form a chain of an archived entity.
     * @param entityClass - The archived entity.
     * @returns The tenants, with undefined for the rows of no tenant.
     */
    private async findChainTenants(entityClass: Newable<BaseArchivedEntity>): Promise<(string | undefined)[]> {
        const tenantProperty: string | undefined = this.findTenantProperty(entityClass);
        if (tenantProperty == undefined) {
            return [undefined];
        }
        const repository: Repository<BaseArchivedEntity> = inject(repositoryTokenFor(entityClass));
        // the entity declares the tenant property and the base it is read through does not, as the chain service has it
        const groupBy: readonly GroupKeysOf<BaseArchivedEntity>[]
            = [tenantProperty] as unknown as readonly GroupKeysOf<BaseArchivedEntity>[];
        const groups: object[] = await repository.count({ groupBy, acrossTenants: true, unscoped: true });
        return groups.map(group => {
            const tenantId: unknown = Reflect.get(group, tenantProperty);
            return typeof tenantId === 'string' ? tenantId : undefined;
        });
    }

    /**
     * Validates every file and copy the rows of one chain recorded, collecting what does not hold.
     * @param entityClass - The archived entity.
     * @param tenantId - The tenant of the chain, or undefined for the rows of no tenant.
     * @param problems - Where the files that do not hold are collected.
     * @returns How many files and copies were read.
     */
    private async validateFilesOfChain(
        entityClass: Newable<BaseArchivedEntity>,
        tenantId: string | undefined,
        problems: ArchivedFileProblem[]
    ): Promise<number> {
        // a row of no tenant holds no file, as a file is stored in a tenant
        if (tenantId == undefined) {
            return 0;
        }
        const tenantProperty: string | undefined = this.findTenantProperty(entityClass);
        const repository: Repository<BaseArchivedEntity> = inject(repositoryTokenFor(entityClass));
        let checked: number = 0;
        let after: number = 0;
        for (;;) {
            const page: BaseArchivedEntity[] = await repository.findAll({
                where: {
                    ...tenantProperty == undefined ? {} : Object.fromEntries([[tenantProperty, tenantId]]),
                    chainSequence: { greaterThan: after }
                },
                order: { chainSequence: 'ASC' },
                limit: PAGE_SIZE,
                acrossTenants: true,
                unscoped: true
            });
            const checks: FileCheck[] = page.flatMap(row => row.archivedFiles
                .flatMap(file => [file.id, ...file.copies].map(id => ({ row, file, id }))));
            await this.tenantService.runAs(tenantId, async () => await this.validateFiles(entityClass, tenantId, checks, problems));
            checked += checks.length;
            if (page.length < PAGE_SIZE) {
                return checked;
            }
            after = page.at(-1)?.chainSequence ?? after;
        }
    }

    /**
     * Validates files of the current tenant and their copies against what their rows recorded, reading the rows of
     * the files in one go.
     * @param entityClass - The archived entity.
     * @param tenantId - The tenant.
     * @param checks - Each file and copy, with its row.
     * @param problems - Where the files that do not hold are collected.
     */
    private async validateFiles(
        entityClass: Newable<BaseArchivedEntity>,
        tenantId: string,
        checks: FileCheck[],
        problems: ArchivedFileProblem[]
    ): Promise<void> {
        const records: Map<string, FileRecord> = new Map((await this.fileService.findFiles(checks.map(check => check.id)))
            .map(record => [record.id, record]));
        const report: (check: FileCheck, reason: ArchivedFileProblemReason, message: string) => void = (check, reason, message) => {
            problems.push({ entityName: entityClass.name, tenantId, rowId: check.row.id, fileId: check.id, reason, message });
        };
        await PromiseUtilities.allChunked(checks, async check => {
            const record: FileRecord | undefined = records.get(check.id);
            if (record == undefined) {
                report(check, 'missing', `The file ${check.id} has no FileRecord.`);
                return;
            }
            if (record.sha256 !== check.file.sha256) {
                report(check, 'changed', `The FileRecord of the file ${check.id} names another SHA-256 than the row recorded.`);
                return;
            }
            try {
                // read to its end, where the stream fails when the bytes do not match
                await pipeline(await this.fileService.readStream(check.id), new Writable({ write: (_chunk, _encoding, next) => next() }));
            }
            catch (error) {
                const message: string = error instanceof Error ? error.message : String(error);
                report(check, this.resolveProblemReason(error), message);
            }
        });
    }

    private resolveProblemReason(error: unknown): ArchivedFileProblemReason {
        if (error instanceof FileHashMismatchError) {
            return 'changed';
        }
        return error instanceof NotFoundError ? 'missing' : 'unreadable';
    }

    /**
     * Reads a file of the current tenant onto this instance's disk, and hands the bytes over once they matched.
     * @param id - The id of the file.
     * @returns The bytes, which are deleted from the disk once the stream closes.
     */
    private async readChecked(id: string): Promise<Readable> {
        const source: Readable = await this.fileService.readStream(id);
        await FsUtilities.mkdir(this.stagingFolder);
        const staged: FsPath = FsUtilities.getPath(this.stagingFolder, UUIDUtilities.generate());
        try {
            // the stream fails at its end when the bytes do not match, which is too late for a download already sent
            await pipeline(source, FsUtilities.createWriteStream(staged));
        }
        catch (error) {
            await FsUtilities.rm(staged);
            throw error;
        }
        const checked: Readable = FsUtilities.createReadStream(staged);
        checked.once('close', () => void this.deleteStaged(staged));
        return checked;
    }

    private async deleteStaged(staged: FsPath): Promise<void> {
        try {
            await FsUtilities.rm(staged);
        }
        catch (error) {
            // the file service deletes a staged file left behind for a day when the application starts
            this.logger.warn(`Could not delete the staged file ${staged}: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    /**
     * The filter of the rows whose retention ended.
     * @param now - The moment.
     * @returns The filter.
     */
    private whereDue<T extends BaseArchivedEntity>(now: Date): Where<T> {
        // `retainUntil` of every archived entity, which `Where<T>` cannot be built from without knowing T
        return { retainUntil: { beforeOrOn: now } } as Where<T>;
    }

    private findTenantProperty(entityClass: Newable<BaseArchivedEntity>): string | undefined {
        const tenant: EntityTenant | undefined = MetadataUtilities.getEntityMetadata(entityClass)?.tenant;
        return tenant == undefined || tenant === 'shared' ? undefined : tenant.property;
    }
}