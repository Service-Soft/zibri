import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { DataSourceInterface, IsolationLevel } from '../data-source/data-sources/data-source.interface';
import { ValKeyDataSource } from '../data-source/data-sources/val-key/val-key-data-source.model';
import { FindAllOptions } from '../data-source/models/options/find-all-options.model';
import { Where } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository/repository';
import { ScopedWhere, ScopeWhereUtilities } from '../data-source/scopes/scope-where.utilities';
import { TenantUtilities } from '../data-source/tenancy/tenant.utilities';
import { Transaction } from '../data-source/transaction/transaction.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { EntityMetadata } from '../entity/decorators/entity.decorator';
import { PropertyMetadata } from '../entity/decorators/property.decorator';
import { isRelationMetadata } from '../entity/models/is-relation-metadata.function';
import { Relation } from '../entity/models/relation.enum';
import { InternalError } from '../error-handling/internal-error.model';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { JsonUtilities } from '../utilities/json.utilities';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { BackupResourceInterface } from './backup-resource.interface';
import { StoredRowUtilities } from './stored-row.utilities';
import { TenantBackupSettings } from './tenant/tenant-backup-settings.model';
import { TenantBackupTransport } from './tenant/tenant-backup-transport.model';
import { TenantRowsEntity, TenantRowsRow } from './tenant-rows-entity.model';
import { TenantRowsHeldRows, TenantRowsReader } from './tenant-rows-held-rows.model';
import { TenantRowsStandInUtilities } from './tenant-rows-stand-in.utilities';

/**
 * The shape of the lines a backup of a tenant's rows is written in.
 */
const TENANT_ROWS_FORMAT_VERSION: number = 1;

/**
 * The entities whose rows configure a tenant's backups, which a backup of the tenant leaves out.
 */
const BACKUP_CONFIGURATION_ENTITIES: Newable<BaseEntity>[] = [TenantBackupTransport, TenantBackupSettings];

/**
 * How many rows a restore writes in one call.
 */
const ROWS_PER_INSERT: number = 500;

/**
 * The first line of a backup of a tenant's rows.
 */
type TenantRowsHeaderLine = {
    /**
     * Marks the line as the header.
     */
    kind: 'header',
    /**
     * The shape the lines are written in.
     */
    formatVersion: number,
    /**
     * The tenant whose rows the backup holds.
     */
    tenantId: string
};

/**
 * A line of a backup of a tenant's rows holding one row.
 */
type TenantRowsRowLine = {
    /**
     * Marks the line as a row.
     */
    kind: 'row',
    /**
     * The table of the entity the row is of.
     */
    entity: string,
    /**
     * The row, as the line holds it.
     */
    row: Record<string, unknown>
};

/**
 * One line of a backup of a tenant's rows, as JSON.
 */
type TenantRowsLine = TenantRowsHeaderLine | TenantRowsRowLine;

/**
 * The rows of one entity a restore collects before it writes them.
 */
type TenantRowsPendingWrite = {
    /**
     * The entity.
     */
    entity: TenantRowsEntity,
    /**
     * The rows written new.
     */
    inserted: DeepPartial<BaseEntity>[],
    /**
     * The rows written over the stored rows holding their ids.
     */
    written: DeepPartial<BaseEntity>[]
};

/**
 * A reference from the rows of an entity to those of another one it covers.
 */
type TenantRowsReference = {
    /**
     * The property of the row holding it: the join column, or the relation whose join rows it writes.
     */
    key: string,
    /**
     * The entity referred to.
     */
    target: Newable<BaseEntity>,
    /**
     * The value of the property referring to nothing.
     */
    empty: null | [],
    /**
     * Whether a row may refer to nothing, so that it can be written before its target.
     */
    mayBeEmpty: boolean
};

/**
 * The rows one tenant holds in one data source, as a backup resource: read and written back as they are
 * stored, encrypted and hashed values included, so that a restore brings back exactly what was read.
 *
 * Covers the entities that belong to tenants and are backed up. Those that are append-only or chained are
 * kept as they are: a restore never changes what they recorded, and a backup leaves them out.
 */
export class TenantRowsBackupResource implements BackupResourceInterface {
    constructor(
        private readonly dataSource: DataSourceInterface,
        private readonly tenantId: string
    ) {}

    /**
     * Whether a data source holds rows of tenants that a backup of a tenant covers.
     * @param dataSource - The data source.
     * @returns Whether it does.
     */
    static holdsTenantRows(dataSource: DataSourceInterface): boolean {
        return dataSource.entities.some(entity => this.isCovered(entity));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    createBackupData(): Readable {
        return Readable.from(this.resolveLines());
    }

    /**
     * Replaces the tenant's rows with those of a backup of them, in one transaction of the data source:
     * the rows of the backup are written back with their ids, and the rows created since are removed. On
     * a valkey data source restoring directly, as they come instead, a batch at a time.
     *
     * A row that a row outside the backup points at, such as one of an append-only entity, is written over
     * in place, and kept when the backup does not hold it, soft deleted where its entity soft deletes. A
     * value of a unique such a kept row holds, which the backup gives to another row, gives way to a
     * stand-in: `<value>_<moment of the restore>` for a text, the next free value for a number or a date.
     * @param backupData - What {@link createBackupData} produced.
     * @param reopenBackupData - Reads it again from the start, which a restore keeping rows needs.
     * @throws When the data is not a backup of this tenant's rows.
     */
    async restoreBackup(backupData: Readable, reopenBackupData?: () => Readable): Promise<void> {
        const entities: TenantRowsEntity[] = this.resolveEntities();
        const byTable: Map<string, TenantRowsEntity> = new Map(entities.map(e => [e.metadata.tableName, e]));
        const lines: AsyncIterator<TenantRowsLine> = this.readLines(backupData)[Symbol.asyncIterator]();
        // before anything is removed, which a restore in place does not take back
        await this.validateHeaderOf(lines);
        const inPlace: boolean = this.restoresInPlace();
        const transaction: Transaction | undefined = inPlace ? undefined : await this.dataSource.startTransaction();
        try {
            const held: TenantRowsHeldRows = await TenantRowsHeldRows.resolve(this.dataSource, entities, this.tenantId, transaction);
            let rows: AsyncIterable<TenantRowsRow> = this.resolveRows(lines, byTable);
            let before: Map<TenantRowsEntity, DeepPartial<BaseEntity>[]> = new Map();
            if (!held.isEmpty) {
                if (reopenBackupData == undefined) {
                    throw new InternalError(
                        `A restore of the tenant "${this.tenantId}" keeping rows needs to read its backup more than once.`
                    );
                }
                const readRows: TenantRowsReader = () => this.readRows(reopenBackupData(), byTable);
                // every row once before anything is written: which held rows the backup holds, and which
                // values of theirs it gives to other rows, decide what is written first
                for await (const [entity, row] of rows) {
                    held.observe(entity, row);
                }
                before = await held.resolveWritesBefore(TenantRowsStandInUtilities.resolveStamp(new Date()), readRows);
                rows = readRows();
            }
            await this.removeNotHeld(entities, held, transaction);
            // nothing removed holds a value now, and every stand-in is a value no row holds
            for (const [entity, writes] of before) {
                for (const chunk of PromiseUtilities.resolveChunks(writes, ROWS_PER_INSERT)) {
                    await this.resolveRepository(entity).updateEachAsStored(chunk, transaction);
                }
            }
            await this.writeRows(rows, held, inPlace, transaction);
            await transaction?.commit();
            const kept: string[] = held.describeKept();
            if (kept.length) {
                inject(ZIBRI_DI_TOKENS.LOGGER).warn(
                    `The restore of the tenant "${this.tenantId}" kept rows created since the backup, `
                    + `which rows outside it point at: ${kept.join('; ')}.`
                );
            }
        }
        catch (error) {
            await transaction?.rollback();
            throw error;
        }
    }

    /**
     * Removes every row of the tenant that is not held, the rows pointing at others first, so that nothing
     * still points at a row once it goes. A reference to rows removed before its own is emptied before any
     * is. A held row points at held rows alone.
     * @param entities - The entities the backup covers.
     * @param held - The rows held.
     * @param transaction - The transaction of the restore.
     */
    private async removeNotHeld(
        entities: TenantRowsEntity[],
        held: TenantRowsHeldRows,
        transaction: Transaction | undefined
    ): Promise<void> {
        const notHeld: Map<TenantRowsEntity, ScopedWhere<BaseEntity>> = new Map(entities.map(entity => {
            const ids: string[] = held.getIds(entity);
            return [
                entity, ids.length
                    ? ScopeWhereUtilities.applyToWhere(
                        entity.where,
                        { id: { notOneOf: ids } },
                        MetadataUtilities.getModelProperties(entity.entityClass)
                    )
                    : { matchesNothing: false, where: entity.where }
            ];
        }));
        for (const entity of entities.filter(e => Object.keys(e.deferred).length)) {
            const where: ScopedWhere<BaseEntity> | undefined = notHeld.get(entity);
            if (where?.where != undefined && !where.matchesNothing) {
                await this.resolveRepository(entity).updateAllAsStored(where.where, entity.deferred, transaction);
            }
        }
        for (const entity of [...entities].reverse()) {
            const where: ScopedWhere<BaseEntity> | undefined = notHeld.get(entity);
            if (where?.where != undefined && !where.matchesNothing) {
                await this.resolveRepository(entity).removeAsStored(where.where, transaction);
            }
        }
    }

    /**
     * Writes the rows of the backup: a held one over the stored row, any other one new.
     * @param rows - The rows, each with its entity.
     * @param held - The rows held.
     * @param inPlace - Whether the restore writes in place rather than in one transaction.
     * @param transaction - The transaction of the restore.
     */
    private async writeRows(
        rows: AsyncIterable<TenantRowsRow>,
        held: TenantRowsHeldRows,
        inPlace: boolean,
        transaction: Transaction | undefined
    ): Promise<void> {
        // held until every row is in: the id and the references of each row written before its targets
        const deferred: Map<TenantRowsEntity, DeepPartial<BaseEntity>[]> = new Map();
        let pending: TenantRowsPendingWrite | undefined;
        const flush: () => Promise<void> = async () => {
            if (pending?.inserted.length) {
                await this.resolveRepository(pending.entity).insertAsStored(
                    this.resolveParentsFirst(pending.entity, pending.inserted),
                    transaction
                );
            }
            // after the new ones, which a row written over in place may point at
            if (pending?.written.length) {
                await this.writeOverStored(pending.entity, pending.written, transaction);
            }
            pending = undefined;
        };
        for await (const [entity, row] of rows) {
            if (pending?.entity !== entity) {
                await flush();
                pending = { entity, inserted: [], written: [] };
            }
            const written: DeepPartial<BaseEntity> = this.resolveWithoutDeferred(entity, row, deferred);
            (held.isHeld(entity, String(row.id)) ? pending.written : pending.inserted).push(written);
            // a table whose rows point at each other is written at once, its parents first: its
            // foreign keys are checked at the end of each statement. In place there are none to check
            if (pending.inserted.length + pending.written.length >= ROWS_PER_INSERT && (inPlace || !entity.selfReferences.length)) {
                await flush();
            }
        }
        await flush();
        for (const [entity, references] of deferred) {
            for (const chunk of PromiseUtilities.resolveChunks(references, ROWS_PER_INSERT)) {
                await this.resolveRepository(entity).updateEachAsStored(chunk, transaction);
            }
        }
    }

    /**
     * Writes rows of the backup over the stored rows holding their ids, so that each is what the backup
     * holds: a property the backup holds no value of, and that may hold none, holds none.
     * @param entity - The entity.
     * @param rows - The rows, each with its id.
     * @param transaction - The transaction of the restore.
     */
    private async writeOverStored(
        entity: TenantRowsEntity,
        rows: DeepPartial<BaseEntity>[],
        transaction: Transaction | undefined
    ): Promise<void> {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entity.entityClass);
        const emptied: string[] = ObjectUtilities.entries(properties)
            .filter(([key, p]) => key !== 'id' && !isRelationMetadata(p) && p.required !== true)
            .map(([key]) => key);
        const whole: DeepPartial<BaseEntity>[] = rows.map(row => ({
            ...Object.fromEntries(emptied.filter(key => Reflect.get(row, key) === undefined).map(key => [key, null])),
            ...row
        }));
        // an update merges an object into the stored one, which would keep what the backup does not hold.
        // A save replaces it, a statement per row on some stores, so only where there is an object
        if (Object.values(properties).some(p => p.type === 'object')) {
            await this.resolveRepository(entity).saveAsStored(whole, transaction);
            return;
        }
        await this.resolveRepository(entity).updateEachAsStored(whole, transaction);
    }

    /**
     * A row as it is written before the rows its deferred references point at: with them empty. What they
     * hold is kept to be written once every row is.
     * @param entity - The entity.
     * @param row - The row.
     * @param deferred - Collects, by entity, the references of each row that refers to something.
     * @returns The row to write.
     */
    private resolveWithoutDeferred(
        entity: TenantRowsEntity,
        row: DeepPartial<BaseEntity>,
        deferred: Map<TenantRowsEntity, DeepPartial<BaseEntity>[]>
    ): DeepPartial<BaseEntity> {
        const keys: string[] = Object.keys(entity.deferred);
        if (!keys.length) {
            return row;
        }
        const references: DeepPartial<BaseEntity> = { id: row.id };
        let refers: boolean = false;
        for (const key of keys) {
            const value: unknown = Reflect.get(row, key);
            if (value != undefined && !(Array.isArray(value) && !value.length)) {
                Reflect.set(references, key, value);
                refers = true;
            }
        }
        if (refers) {
            const rows: DeepPartial<BaseEntity>[] = deferred.get(entity) ?? [];
            rows.push(references);
            deferred.set(entity, rows);
        }
        return { ...row, ...entity.deferred };
    }

    /**
     * Validates that the first line of a backup is its header, and that it is a backup of this tenant.
     * @param lines - The lines of the backup, of which this reads the first.
     * @throws When it is not.
     */
    private async validateHeaderOf(lines: AsyncIterator<TenantRowsLine>): Promise<void> {
        const first: IteratorResult<TenantRowsLine> = await lines.next();
        if (first.done === true || first.value.kind !== 'header') {
            throw new InternalError(`The backup of the tenant "${this.tenantId}" holds no header.`);
        }
        this.validateHeader(first.value);
    }

    /**
     * The rows of a backup after its header, each with its entity.
     * @param lines - The lines of the backup, its header read.
     * @param byTable - The entities backed up for a tenant, by their table.
     * @yields Each row, as stored.
     */
    private async* resolveRows(
        lines: AsyncIterator<TenantRowsLine>,
        byTable: Map<string, TenantRowsEntity>
    ): AsyncGenerator<TenantRowsRow> {
        for (let next: IteratorResult<TenantRowsLine> = await lines.next(); next.done !== true; next = await lines.next()) {
            const [entity, row]: [TenantRowsEntity, Record<string, unknown>] = this.resolveRowOf(next.value, byTable);
            yield [entity, this.decodeRow(entity, row)];
        }
    }

    /**
     * Reads the rows of a backup, each with its entity.
     * @param data - The backup, from its start.
     * @param byTable - The entities backed up for a tenant, by their table.
     * @yields Each row, as stored.
     */
    private async* readRows(data: Readable, byTable: Map<string, TenantRowsEntity>): AsyncGenerator<TenantRowsRow> {
        const lines: AsyncIterator<TenantRowsLine> = this.readLines(data)[Symbol.asyncIterator]();
        await this.validateHeaderOf(lines);
        yield* this.resolveRows(lines, byTable);
    }

    /**
     * Resolves the row a line after the header holds, and its entity.
     * @param line - The line.
     * @param byTable - The entities backed up for a tenant, by their table.
     * @returns The entity, and the row as the line holds it.
     * @throws When the line is no row, or one of an entity not backed up for a tenant.
     */
    private resolveRowOf(line: TenantRowsLine, byTable: Map<string, TenantRowsEntity>): [TenantRowsEntity, Record<string, unknown>] {
        if (line.kind !== 'row') {
            throw new InternalError(`The backup of the tenant "${this.tenantId}" holds a second header.`);
        }
        const entity: TenantRowsEntity | undefined = byTable.get(line.entity);
        if (entity == undefined) {
            throw new InternalError(
                `The backup of the tenant "${this.tenantId}" holds rows of "${line.entity}", `
                + 'which this application does not back up for a tenant.'
            );
        }
        return [entity, line.row];
    }

    /**
     * Whether the rows are restored in place rather than in one transaction: on a valkey data source
     * restoring directly, whose transaction holds every row it writes until it commits, in one request.
     * @returns Whether they are.
     */
    private restoresInPlace(): boolean {
        return this.dataSource instanceof ValKeyDataSource && this.dataSource.restoreMode === 'direct';
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    validateBackupConfiguration(): void {
        // what it needs is the data source's, which validates itself
    }

    /**
     * A restore of a tenant's rows is one transaction of the data source, with nothing after it, unless it
     * restores in place, which leaves part of the backup written when it fails part way.
     * @param backupData - The data, which this does not read.
     * @returns Whether it is one transaction.
     */
    async resolveRestoresWhole(backupData: Readable): Promise<boolean> {
        backupData.destroy();
        return await Promise.resolve(!this.restoresInPlace());
    }

    private static isCovered(entityClass: Newable<BaseEntity>): boolean {
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
        // what configures the tenant's backups stays as it is set: a restore taking back a transport or a
        // retention set since would undo a choice made after the backup, not data of the time
        return metadata != undefined && metadata.tenant !== 'shared' && metadata.backedUp !== false
            && !metadata.appendOnly && !metadata.chained
            && !BACKUP_CONFIGURATION_ENTITIES.includes(entityClass);
    }

    /**
     * The entities the backup covers, each after those its rows point at.
     * @returns The entities.
     */
    private resolveEntities(): TenantRowsEntity[] {
        const covered: Newable<BaseEntity>[] = this.dataSource.entities.filter(entity => TenantRowsBackupResource.isCovered(entity));
        const references: Map<Newable<BaseEntity>, TenantRowsReference[]> = new Map(
            covered.map(e => [e, this.resolveReferences(e, covered)])
        );
        const needed: Map<Newable<BaseEntity>, Set<Newable<BaseEntity>>> = this.resolveNeeded(references);
        const ordered: TenantRowsEntity[] = [];
        const visiting: Set<Newable<BaseEntity>> = new Set();
        const visit: (entityClass: Newable<BaseEntity>) => void = entityClass => {
            if (ordered.some(e => e.entityClass === entityClass) || visiting.has(entityClass)) {
                return;
            }
            visiting.add(entityClass);
            for (const reference of references.get(entityClass) ?? []) {
                // followed, the target would go first, before what it cannot be written without: it goes
                // after them, and the reference is written once it is. Following only what may be empty
                // this way, a reference that may not be is never reached back through, unless every
                // reference of the cycle is one that may not be
                if (reference.mayBeEmpty && [...needed.get(reference.target) ?? []].some(e => visiting.has(e))) {
                    continue;
                }
                visit(reference.target);
            }
            visiting.delete(entityClass);
            const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
            const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
            const where: Where<BaseEntity> | undefined = metadata == undefined
                ? undefined
                : TenantUtilities.resolveRowsOf(entityClass, metadata, this.tenantId);
            if (metadata != undefined && where != undefined) {
                ordered.push({
                    entityClass,
                    metadata,
                    where,
                    joined: ObjectUtilities.entries(properties).filter(([, p]) => TenantRowsBackupResource.writesJoinRows(p))
                        .map(([key]) => key),
                    selfReferences: ObjectUtilities.entries(properties)
                        .filter(([, p]) => isRelationMetadata(p) && (p.type === Relation.MANY_TO_ONE || p.type === Relation.BELONGS_TO_ONE)
                            && p.target() === entityClass)
                        .map(([key]) => key),
                    deferred: {}
                });
            }
        };
        for (const entityClass of covered) {
            visit(entityClass);
        }
        // a cycle of references none of which may be empty is left as the walk placed it: a data source
        // checking its keys at the end of each statement holds no rows in one, and one checking none
        // writes them in any order
        for (const [index, entity] of ordered.entries()) {
            for (const reference of references.get(entity.entityClass) ?? []) {
                if (reference.mayBeEmpty && ordered.findIndex(e => e.entityClass === reference.target) > index) {
                    Reflect.set(entity.deferred, reference.key, reference.empty);
                }
            }
        }
        return ordered;
    }

    /**
     * The references from the rows of an entity to those of another one the backup covers: a key of its
     * own, or join rows it writes, which point at both sides. Those to its own rows are written parents
     * first instead.
     * @param entityClass - The entity.
     * @param covered - The entities the backup covers.
     * @returns The references.
     */
    private resolveReferences(entityClass: Newable<BaseEntity>, covered: Newable<BaseEntity>[]): TenantRowsReference[] {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        return ObjectUtilities.entries(properties).flatMap(([key, property]): TenantRowsReference[] => {
            if (!isRelationMetadata(property) || property.target() === entityClass || !covered.includes(property.target())) {
                return [];
            }
            if (property.type === Relation.MANY_TO_ONE || property.type === Relation.BELONGS_TO_ONE) {
                const mayBeEmpty: boolean = properties[property.joinColumn]?.required !== true;
                return [{ key: property.joinColumn, target: property.target(), empty: null, mayBeEmpty }];
            }
            // a join row can be written whenever both of its sides are
            return TenantRowsBackupResource.writesJoinRows(property)
                ? [{ key, target: property.target(), empty: [], mayBeEmpty: true }]
                : [];
        });
    }

    /**
     * Resolves which entities the rows of each one cannot be written without, through references that may
     * not be empty, directly or through others.
     * @param references - The references of each entity.
     * @returns The entities each one needs.
     */
    private resolveNeeded(
        references: Map<Newable<BaseEntity>, TenantRowsReference[]>
    ): Map<Newable<BaseEntity>, Set<Newable<BaseEntity>>> {
        const needed: Map<Newable<BaseEntity>, Set<Newable<BaseEntity>>> = new Map();
        for (const entityClass of references.keys()) {
            const reached: Set<Newable<BaseEntity>> = new Set();
            const pending: Newable<BaseEntity>[] = [entityClass];
            for (let next: Newable<BaseEntity> | undefined = pending.pop(); next != undefined; next = pending.pop()) {
                for (const reference of references.get(next) ?? []) {
                    if (!reference.mayBeEmpty && !reached.has(reference.target)) {
                        reached.add(reference.target);
                        pending.push(reference.target);
                    }
                }
            }
            needed.set(entityClass, reached);
        }
        return needed;
    }

    /**
     * Whether a relation to many rows is the side whose rows hold the join rows: the one owning the join
     * table. Written from both sides, every join row would be written twice.
     * @param property - The relation.
     * @returns Whether it is.
     */
    static writesJoinRows(property: PropertyMetadata): boolean {
        return isRelationMetadata(property)
            && property.type === Relation.MANY_TO_MANY
            && property.persistence
            && property.joinTable !== false;
    }

    private async* resolveLines(): AsyncGenerator<string> {
        // every entity as of one moment: read one after another without it, a row written meanwhile could
        // be in the backup while a row it points at is not
        // only read, so held as long as the backup takes, however long it waits on the pipeline
        const transaction: Transaction = await this.dataSource.startTransaction({
            isolationLevel: IsolationLevel.REPEATABLE_READ,
            idleTimeoutInMs: 0
        });
        try {
            yield this.resolveLine({ kind: 'header', formatVersion: TENANT_ROWS_FORMAT_VERSION, tenantId: this.tenantId });
            for (const entity of this.resolveEntities()) {
                const relations: FindAllOptions<BaseEntity>['relations'] = Object.fromEntries(entity.joined.map(key => [key, true]));
                for await (const row of this.resolveRepository(entity).streamAsStored(entity.where, relations, transaction)) {
                    yield this.resolveLine({ kind: 'row', entity: entity.metadata.tableName, row: this.encodeRow(entity, row) });
                }
            }
        }
        finally {
            await transaction.rollback();
        }
    }

    /**
     * A row as a line holds it: every column as JSON, a file as base64, and of a relation to many rows
     * whose join rows it writes, the ids of those rows.
     * @param entity - The entity.
     * @param row - The row as stored.
     * @returns What the line holds.
     */
    private encodeRow(entity: TenantRowsEntity, row: BaseEntity): Record<string, unknown> {
        return StoredRowUtilities.encode(entity.entityClass, row, (key, value) => this.encodeJoined(entity, key, value));
    }

    /**
     * Of a relation to many rows whose join rows the entity writes, the ids of those rows.
     * @param entity - The entity.
     * @param key - The relation.
     * @param value - What the row holds of it.
     * @returns The ids, or undefined for a relation left out.
     */
    private encodeJoined(entity: TenantRowsEntity, key: string, value: unknown): unknown[] | undefined {
        return entity.joined.includes(key) && Array.isArray(value)
            ? value.flatMap((related: unknown) => typeof related === 'object' && related != undefined && 'id' in related
                ? [{ id: related.id }]
                : [])
            : undefined;
    }

    /**
     * A row as a line holds it, read back into what it was stored as.
     * @param entity - The entity.
     * @param encoded - What the line holds.
     * @returns The row.
     * @throws When the line holds no row.
     */
    private decodeRow(entity: TenantRowsEntity, encoded: Record<string, unknown>): DeepPartial<BaseEntity> {
        const parsed: unknown = StoredRowUtilities.decode(entity.entityClass, encoded);
        if (!this.isRow(parsed)) {
            throw new InternalError(
                `The backup of the tenant "${this.tenantId}" holds a row of "${entity.metadata.tableName}" without an id.`
            );
        }
        return parsed;
    }

    private isRow(value: unknown): value is DeepPartial<BaseEntity> {
        return typeof value === 'object' && value != undefined && 'id' in value && typeof value.id === 'string';
    }

    /**
     * Orders the rows of an entity whose rows point at each other so that each comes after the one it
     * points at.
     * @param entity - The entity.
     * @param rows - Its rows.
     * @returns The rows, parents first; as given for an entity whose rows point at none of its own.
     */
    private resolveParentsFirst(entity: TenantRowsEntity, rows: DeepPartial<BaseEntity>[]): DeepPartial<BaseEntity>[] {
        if (!entity.selfReferences.length) {
            return rows;
        }
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entity.entityClass);
        const columns: string[] = entity.selfReferences.flatMap(key => {
            const property: PropertyMetadata | undefined = properties[key];
            return isRelationMetadata(property) && 'joinColumn' in property && typeof property.joinColumn === 'string'
                ? [property.joinColumn]
                : [];
        });
        const byId: Map<string, DeepPartial<BaseEntity>> = new Map(rows.flatMap(row => row.id == undefined ? [] : [[row.id, row]]));
        const ordered: DeepPartial<BaseEntity>[] = [];
        const placed: Set<string> = new Set();
        const place: (row: DeepPartial<BaseEntity>, path: Set<string>) => void = (row, path) => {
            const id: string = row.id ?? '';
            if (placed.has(id) || path.has(id)) {
                return;
            }
            path.add(id);
            for (const column of columns) {
                const parent: DeepPartial<BaseEntity> | undefined = byId.get(String(Reflect.get(row, column)));
                if (parent != undefined) {
                    place(parent, path);
                }
            }
            placed.add(id);
            ordered.push(row);
        };
        for (const row of rows) {
            place(row, new Set());
        }
        return ordered;
    }

    private validateHeader(line: TenantRowsHeaderLine): void {
        if (line.formatVersion !== TENANT_ROWS_FORMAT_VERSION) {
            throw new InternalError(
                `The backup of a tenant is written in shape ${line.formatVersion}, and this build reads ${TENANT_ROWS_FORMAT_VERSION}.`
            );
        }
        if (line.tenantId !== this.tenantId) {
            throw new InternalError(`The backup is of the tenant "${line.tenantId}", and is restored into "${this.tenantId}".`);
        }
    }

    private resolveRepository(entity: TenantRowsEntity): Repository<BaseEntity> {
        // of this data source by name: an entity declared in several data sources has a repository in each
        return this.dataSource.getRepository(entity.entityClass);
    }

    private resolveLine(line: TenantRowsLine): string {
        // a value holding a line break is written as two characters by JSON, so a line is one row
        return `${JsonUtilities.stringify(line)}\n`;
    }

    private async* readLines(data: Readable): AsyncGenerator<TenantRowsLine> {
        const decoder: StringDecoder = new StringDecoder('utf8');
        let rest: string = '';
        for await (const piece of data) {
            rest += decoder.write(Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece)));
            const lines: string[] = rest.split('\n');
            rest = lines.pop() ?? '';
            for (const line of lines.filter(l => l.length)) {
                yield JsonUtilities.parse<TenantRowsLine>(line);
            }
        }
        rest += decoder.end();
        if (rest.length) {
            yield JsonUtilities.parse<TenantRowsLine>(rest);
        }
    }
}