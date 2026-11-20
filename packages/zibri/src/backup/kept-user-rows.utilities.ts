import { createInterface } from 'node:readline';
import { Readable } from 'node:stream';

import { DataSourceInterface, isDataSource } from '../data-source/data-sources/data-source.interface';
import { Where, WhereFilter } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository/repository';
import { Transaction } from '../data-source/transaction/transaction.model';
import { UpsertIdentityUtilities } from '../data-source/upsert-identity.utilities';
import { BaseEntity } from '../entity/base-entity.model';
import { EntityMetadata } from '../entity/decorators/entity.decorator';
import { UniqueGroup } from '../entity/models/unique-declaration.model';
import { InternalError } from '../error-handling/internal-error.model';
import { ModelRegistry } from '../global/model-registry/model.registry';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { BackupDigest } from './backup-digest.model';
import { BackupResourceInterface } from './backup-resource.interface';
import { StagedFile } from './staged-file.model';
import { StagingUtilities } from './staging.utilities';
import { StoredRowUtilities } from './stored-row.utilities';

/**
 * A row of an entity declared `backedUp: 'keptForCurrentUsers'`, which says whose it is.
 */
type KeptUserRow = BaseEntity & {
    /**
     * The user the row belongs to.
     */
    userId: string
};

/**
 * An entity declared `backedUp: { keptWith, by }`, and the entity of the data source its rows belong to.
 */
type KeptWithEntity = {
    /**
     * The entity.
     */
    entity: Newable<BaseEntity>,
    /**
     * The entity its rows belong to.
     */
    owner: Newable<KeptUserRow>,
    /**
     * The property naming the row of the owner a row belongs to.
     */
    by: string
};

/**
 * The entities of a data source a restore keeps the rows of the current users of.
 */
type KeptEntities = {
    /**
     * Those declared `backedUp: 'keptForCurrentUsers'`.
     */
    owners: Newable<KeptUserRow>[],
    /**
     * Those declared `backedUp: { keptWith, by }`.
     */
    keptWith: KeptWithEntity[],
    /**
     * Those declared `backedUp: { keptWith, by }` whose `keptWith` the data source holds no rows of declared
     * `backedUp: 'keptForCurrentUsers'`, with that entity.
     */
    withoutOwner: [Newable<BaseEntity>, Newable<unknown>][]
};

/**
 * What a line of the kept file holds: a batch of the users that existed, and the rows of each entity kept
 * of them, by the table of the entity.
 */
type KeptUserRowsBatch = {
    /**
     * The users.
     */
    userIds: string[],
    /**
     * Their rows, each column as JSON and a file as base64.
     */
    rows: Record<string, Record<string, unknown>[]>
};

/**
 * Finds the users stored, out of some.
 */
type FindStoredUserIds = (userIds: string[]) => Promise<string[]>;

/**
 * What a restore of the application keeps of the entities declared `backedUp: 'keptForCurrentUsers'`, and of
 * those kept with them: the rows of the users that exist when it begins, read before it replaces a data
 * source and written back once it did, in place of the backup's rows of those users.
 */
export abstract class KeptUserRowsUtilities {
    /**
     * How many users a line of the kept file holds, and a transaction writing it back writes.
     */
    private static readonly USERS_PER_BATCH: number = 250;

    /**
     * Whether a resource is a data source holding entities a restore keeps the rows of the current users of.
     * @param resource - The resource.
     * @returns Whether it is.
     */
    static holdsKeptRows(resource: BackupResourceInterface): boolean {
        const kept: KeptEntities = this.findKeptEntities(resource);
        return kept.owners.length > 0 || kept.keptWith.length > 0;
    }

    /**
     * Finds the entities of a data source declared `backedUp: { keptWith, by }` whose `keptWith` it holds no
     * rows of declared `backedUp: 'keptForCurrentUsers'`, which a restore writes as the backup holds them.
     * @param resource - The resource.
     * @returns The entities, with the entity each is kept with.
     */
    static findKeptWithoutOwner(resource: BackupResourceInterface): [Newable<BaseEntity>, Newable<unknown>][] {
        return this.findKeptEntities(resource).withoutOwner;
    }

    /**
     * Stages the rows the kept entities of a data source hold of the users that exist now, a batch of users a line.
     * @param resource - The data source.
     * @param userIds - Every user that exists now.
     * @param file - Where to stage them, and how they are stored.
     * @returns What was staged.
     */
    static async stage(resource: BackupResourceInterface, userIds: AsyncIterable<string>, file: StagedFile): Promise<BackupDigest> {
        const dataSource: DataSourceInterface = this.resolveDataSource(resource);
        return await StagingUtilities.stage(Readable.from(this.resolveLines(dataSource, this.findKeptEntities(resource), userIds)), file);
    }

    /**
     * Writes back what {@link stage} kept: for each user that existed then, the rows kept of it in place of
     * those the backup holds, of the users that are stored now. Writing it back twice writes the same.
     * @param resource - The data source.
     * @param file - The kept file.
     * @param findStoredUserIds - Which users are stored now.
     */
    static async putBack(resource: BackupResourceInterface, file: StagedFile, findStoredUserIds: FindStoredUserIds): Promise<void> {
        const dataSource: DataSourceInterface = this.resolveDataSource(resource);
        const kept: KeptEntities = this.findKeptEntities(resource);
        for await (const line of createInterface({ input: StagingUtilities.read(file), crlfDelay: Number.POSITIVE_INFINITY })) {
            if (!line.length) {
                continue;
            }
            await this.putBackBatch(dataSource, kept, JsonUtilities.parse<KeptUserRowsBatch>(line), findStoredUserIds);
        }
    }

    private static findKeptEntities(resource: BackupResourceInterface): KeptEntities {
        const kept: KeptEntities = { owners: [], keptWith: [], withoutOwner: [] };
        if (!isDataSource(resource)) {
            return kept;
        }
        kept.owners = resource.entities.filter(e => this.isKeptForCurrentUsers(e));
        for (const entity of resource.entities) {
            const backedUp: EntityMetadata['backedUp'] | undefined = MetadataUtilities.getEntityMetadata(entity)?.backedUp;
            if (typeof backedUp !== 'object') {
                continue;
            }
            const target: Newable<unknown> = backedUp.keptWith();
            const owner: Newable<KeptUserRow> | undefined = kept.owners.find(o => o === target);
            // backed up as any other entity then, which the application warns about as it starts
            if (owner == undefined) {
                kept.withoutOwner.push([entity, target]);
                continue;
            }
            kept.keptWith.push({ entity, owner, by: backedUp.by });
        }
        return kept;
    }

    private static resolveDataSource(resource: BackupResourceInterface): DataSourceInterface {
        if (!isDataSource(resource)) {
            throw new InternalError('The rows of the users are kept of a data source alone.');
        }
        return resource;
    }

    private static async* resolveLines(
        dataSource: DataSourceInterface,
        kept: KeptEntities,
        userIds: AsyncIterable<string>
    ): AsyncGenerator<Buffer> {
        let batch: string[] = [];
        for await (const userId of userIds) {
            batch.push(userId);
            if (batch.length >= this.USERS_PER_BATCH) {
                yield await this.resolveLine(dataSource, kept, batch);
                batch = [];
            }
        }
        if (batch.length) {
            yield await this.resolveLine(dataSource, kept, batch);
        }
    }

    private static async resolveLine(dataSource: DataSourceInterface, kept: KeptEntities, userIds: string[]): Promise<Buffer> {
        const rows: Record<string, Record<string, unknown>[]> = {};
        const ownerIds: Map<Newable<KeptUserRow>, string[]> = new Map();
        for (const owner of kept.owners) {
            const read: KeptUserRow[] = await this.findRows(dataSource.getRepository(owner), { userId: { oneOf: userIds } }, undefined);
            ownerIds.set(owner, read.map(r => r.id));
            rows[this.resolveTableName(owner)] = read.map(r => this.encodeRow(owner, r));
        }
        for (const { entity, owner, by } of kept.keptWith) {
            const ids: string[] = ownerIds.get(owner) ?? [];
            const read: BaseEntity[] = ids.length
                ? await this.findRows(dataSource.getRepository(entity), this.resolveNamingWhere(by, ids), undefined)
                : [];
            rows[this.resolveTableName(entity)] = read.map(r => this.encodeRow(entity, r));
        }
        const batch: KeptUserRowsBatch = { userIds, rows };
        return Buffer.from(`${JsonUtilities.stringify(batch)}\n`);
    }

    private static async putBackBatch(
        dataSource: DataSourceInterface,
        kept: KeptEntities,
        batch: KeptUserRowsBatch,
        findStoredUserIds: FindStoredUserIds
    ): Promise<void> {
        // a user the restore took out takes its rows with it, as it does when the backup lacks it
        const stored: Set<string> = new Set(await findStoredUserIds(batch.userIds));
        const transaction: Transaction = await dataSource.startTransaction();
        try {
            // first what is kept with them, of the rows of the backup and of those kept, while the backup's rows
            // still say which ones belong to the users
            for (const { entity, owner, by } of kept.keptWith) {
                const restored: KeptUserRow[] = await this.findRows(
                    dataSource.getRepository(owner),
                    { userId: { oneOf: batch.userIds } },
                    transaction
                );
                const ids: string[] = [
                    ...restored.map(r => r.id),
                    ...(batch.rows[this.resolveTableName(owner)] ?? []).flatMap(r => typeof r['id'] === 'string' ? [r['id']] : [])
                ];
                if (ids.length) {
                    await dataSource.getRepository(entity).removeAsStored(this.resolveNamingWhere(by, ids), transaction);
                }
            }
            const written: Map<Newable<KeptUserRow>, Set<string>> = new Map();
            for (const owner of kept.owners) {
                const repository: Repository<KeptUserRow> = dataSource.getRepository(owner);
                // the backup's rows of a user that existed: one revoked since the backup stays revoked
                await repository.removeAsStored({ userId: { oneOf: batch.userIds } }, transaction);
                const rows: DeepPartial<KeptUserRow>[] = this.decodeRows(owner, batch)
                    .filter(row => row.userId != undefined && stored.has(row.userId));
                written.set(owner, new Set(rows.flatMap(r => r.id ?? [])));
                await this.insertWinning(repository, owner, rows, transaction);
            }
            for (const { entity, owner, by } of kept.keptWith) {
                const ownerIds: Set<string> = written.get(owner) ?? new Set();
                const rows: DeepPartial<BaseEntity>[] = this.decodeRows(entity, batch).filter(row => {
                    const named: unknown = Reflect.get(row, by);
                    return typeof named === 'string' && ownerIds.has(named);
                });
                await this.insertWinning(dataSource.getRepository(entity), entity, rows, transaction);
            }
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Writes rows as they were stored, over a restored row holding the id of one of them or a value of a unique
     * one of them holds, such as an identity linked to another user since the backup.
     * @param repository - The repository of the entity.
     * @param entity - The entity.
     * @param rows - The rows.
     * @param transaction - The transaction writing them.
     */
    private static async insertWinning<T extends BaseEntity>(
        repository: Repository<T>,
        entity: Newable<T>,
        rows: DeepPartial<T>[],
        transaction: Transaction
    ): Promise<void> {
        if (!rows.length) {
            return;
        }
        await repository.removeAsStored({ id: { oneOf: rows.flatMap(r => r.id ?? []) } } as Where<T>, transaction);
        for (const where of this.resolveUniqueTakers(entity, rows)) {
            await repository.removeAsStored(where, transaction);
        }
        await repository.insertAsStored(rows, transaction);
    }

    /**
     * The filters of the rows taking up a value of a unique that the given rows hold, a filter a unique.
     * @param entity - The entity.
     * @param rows - The rows.
     * @returns The filters, none for an entity declaring no unique.
     */
    private static resolveUniqueTakers<T extends BaseEntity>(entity: Newable<T>, rows: DeepPartial<T>[]): Where<T>[] {
        const uniques: UniqueGroup[] = ModelRegistry.get(entity).keyDescriptor.uniques;
        return uniques.flatMap(group => {
            // a row holding no value of one of them takes up nothing
            const holding: DeepPartial<T>[] = rows.filter(row => group.properties.every(p => Reflect.get(row, p) != undefined));
            const filters: WhereFilter<T>[] = holding.flatMap(row => {
                const where: Where<T> = UpsertIdentityUtilities.resolveConflictWhere(entity, group.properties, row);
                return Array.isArray(where) ? where : [where];
            });
            return filters.length ? [filters] : [];
        });
    }

    /**
     * The filter of the rows naming one of the given rows of the entity they are kept with.
     * @param by - The property naming that row.
     * @param ids - The rows.
     * @returns The filter.
     */
    private static resolveNamingWhere<T extends BaseEntity>(by: string, ids: string[]): Where<T> {
        // which property names the row is declared on the entity rather than known to the type, as
        // TenantUtilities.resolveRowsOf has it of the tenant
        return { [by]: { oneOf: ids } } as Where<T>;
    }

    private static async findRows<T extends BaseEntity>(
        repository: Repository<T>,
        where: Where<T>,
        transaction: Transaction | undefined
    ): Promise<T[]> {
        const rows: T[] = [];
        for await (const row of repository.streamAsStored(where, undefined, transaction)) {
            rows.push(row);
        }
        return rows;
    }

    /**
     * A row as a line holds it: the columns alone, what a row of a user points at is kept by its own entity, if at all.
     * @param entity - The entity.
     * @param row - The row as stored.
     * @returns What the line holds.
     */
    private static encodeRow(entity: Newable<BaseEntity>, row: BaseEntity): Record<string, unknown> {
        return StoredRowUtilities.encode(entity, row);
    }

    /**
     * The rows a line holds of an entity, read back into what they were stored as.
     * @param entity - The entity.
     * @param batch - What the line holds.
     * @returns The rows.
     * @throws When the line holds a row without an id.
     */
    private static decodeRows<T extends BaseEntity>(entity: Newable<T>, batch: KeptUserRowsBatch): DeepPartial<T>[] {
        return (batch.rows[this.resolveTableName(entity)] ?? []).map(encoded => {
            const parsed: unknown = StoredRowUtilities.decode(entity, encoded);
            if (!this.isRow<T>(parsed)) {
                throw new InternalError(`A row of "${this.resolveTableName(entity)}" kept across the restore has no id.`);
            }
            return parsed;
        });
    }

    private static isRow<T extends BaseEntity>(value: unknown): value is DeepPartial<T> {
        return typeof value === 'object' && value != undefined && 'id' in value && typeof value.id === 'string';
    }

    private static isKeptForCurrentUsers(entity: Newable<BaseEntity>): entity is Newable<KeptUserRow> {
        // the decorator refuses one without a string userId
        return MetadataUtilities.getEntityMetadata(entity)?.backedUp === 'keptForCurrentUsers';
    }

    private static resolveTableName(entity: Newable<BaseEntity>): string {
        return MetadataUtilities.getEntityMetadata(entity)?.tableName ?? entity.name;
    }
}