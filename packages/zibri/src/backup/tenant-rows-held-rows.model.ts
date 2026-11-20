import { isSoftDeleteEntityNewable } from '../data-source/change-sets/models/is-soft-delete-entity.function';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { WhereFilterEvaluator } from '../data-source/data-sources/where-converter/where-filter.evaluator';
import { Where } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository/repository';
import { ScopedWhere, ScopeWhereUtilities } from '../data-source/scopes/scope-where.utilities';
import { TenantUtilities } from '../data-source/tenancy/tenant.utilities';
import { Transaction } from '../data-source/transaction/transaction.model';
import { BaseEntity } from '../entity/base-entity.model';
import { EntityMetadata } from '../entity/decorators/entity.decorator';
import { PropertyMetadata, RelationMetadata } from '../entity/decorators/property.decorator';
import { isRelationMetadata } from '../entity/models/is-relation-metadata.function';
import { Relation } from '../entity/models/relation.enum';
import { UniqueGroup } from '../entity/models/unique-declaration.model';
import { InternalError } from '../error-handling/internal-error.model';
import { ModelRegistry } from '../global/model-registry/model.registry';
import { DeepPartial } from '../types/deep-partial.type';
import { Newable } from '../types/newable.type';
import { MetadataUtilities } from '../utilities/metadata.utilities';
import { ObjectUtilities } from '../utilities/object.utilities';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { TenantRowsEntity, TenantRowsRow } from './tenant-rows-entity.model';
import { TenantRowsStandInKind, TenantRowsStandInUtilities } from './tenant-rows-stand-in.utilities';

/**
 * How many rows are read by their ids at once.
 */
const IDS_PER_READ: number = 500;

/**
 * How many stand-ins are tried for one value in one read of the backup.
 */
const CANDIDATES_PER_READ: number = 8;

/**
 * How many stand-ins are tried for one value before the restore gives up on it.
 */
const MAX_CANDIDATES: number = 1024;

/**
 * A row of the tenant a restore writes over in place, or keeps, rather than removing it.
 */
type TenantRowsHeldRow = {
    /**
     * The id of the row.
     */
    id: string,
    /**
     * By unique of its entity, the values it takes up of it as it is stored, encoded, or undefined when it
     * takes up none.
     */
    taken: (string | undefined)[],
    /**
     * The same once it is kept: soft deleted where its entity soft deletes.
     */
    takenKept: (string | undefined)[],
    /**
     * The values of the properties the uniques of its entity name, as stored.
     */
    values: Record<string, unknown>,
    /**
     * Whether it is soft deleted as it is stored.
     */
    deleted: boolean,
    /**
     * Whether the backup holds it, which writes it over in place. One it does not hold is kept.
     */
    inBackup: boolean,
    /**
     * The uniques it takes up a value of that another row of the backup takes up as well, as it is stored.
     */
    contested: Set<number>,
    /**
     * The same, once it is kept.
     */
    contestedKept: Set<number>,
    /**
     * The properties it gives up its value of for a stand-in.
     */
    givenUp: string[]
};

/**
 * The rows one entity holds back from the restore, and what they take up of its uniques.
 */
type TenantRowsHeldEntity = {
    /**
     * The entity.
     */
    entity: TenantRowsEntity,
    /**
     * The uniques of the entity.
     */
    uniques: UniqueGroup[],
    /**
     * Whether the entity soft deletes its rows.
     */
    softDeletes: boolean,
    /**
     * The held rows, by id.
     */
    rows: Map<string, TenantRowsHeldRow>,
    /**
     * By unique, the rows taking up each value of it, as stored or once kept.
     */
    takers: Map<string, TenantRowsHeldRow[]>[],
    /**
     * By property, every value the rows hold of it, encoded, as far as asked for.
     */
    values: Map<string, Set<string>>
};

/**
 * A value of a row that gives it up for a stand-in.
 */
type TenantRowsStandIn = {
    /**
     * The entity of the row.
     */
    held: TenantRowsHeldEntity,
    /**
     * The row giving up the value.
     */
    row: TenantRowsHeldRow,
    /**
     * The property whose value is given up.
     */
    property: string,
    /**
     * The kind of value standing in.
     */
    kind: TenantRowsStandInKind,
    /**
     * The value given up, as stored.
     */
    original: unknown,
    /**
     * The length a text of the property can be at most, if any.
     */
    maxLength: number | undefined,
    /**
     * The value standing in, once one is found.
     */
    found?: {
        /**
         * The value, which can be null.
         */
        value: unknown
    }
};

/**
 * Reads the rows of a backup once more, each with its entity.
 */
export type TenantRowsReader = () => AsyncIterable<TenantRowsRow>;

/**
 * The rows of a tenant a restore cannot remove: those a row outside the backup points at, which it leaves
 * as they are, and those such a row needs, through what it points at in turn. One the backup holds is
 * written over in place. One it does not, created since, is kept, and soft deleted where its entity soft
 * deletes.
 *
 * A value one of them takes up of a unique, which the backup gives another row, is given up for a stand-in
 * that no row holds: in place, until the row gets its own value from the backup, and kept, for good.
 */
export class TenantRowsHeldRows {
    private readonly evaluator: WhereFilterEvaluator = new WhereFilterEvaluator();
    private readonly held: Map<TenantRowsEntity, TenantRowsHeldEntity> = new Map();

    private constructor(private readonly dataSource: DataSourceInterface) {}

    /**
     * Whether no row is held.
     * @returns Whether none is.
     */
    get isEmpty(): boolean {
        return ![...this.held.values()].some(held => held.rows.size);
    }

    /**
     * Resolves the rows of a tenant a restore cannot remove.
     * @param dataSource - The data source.
     * @param entities - The entities the backup covers.
     * @param tenantId - The tenant.
     * @param transaction - The transaction of the restore.
     * @returns The rows.
     */
    static async resolve(
        dataSource: DataSourceInterface,
        entities: TenantRowsEntity[],
        tenantId: string,
        transaction: Transaction | undefined
    ): Promise<TenantRowsHeldRows> {
        const res: TenantRowsHeldRows = new TenantRowsHeldRows(dataSource);
        const byClass: Map<Newable<BaseEntity>, TenantRowsEntity> = new Map(entities.map(e => [e.entityClass, e]));
        let pending: Map<TenantRowsEntity, Set<string>> = await res.findReferencedFromOutside(byClass, tenantId, transaction);
        // what a held row points at is held too: removed, it would leave the held row pointing at nothing
        while (pending.size) {
            const next: Map<TenantRowsEntity, Set<string>> = new Map();
            for (const [entity, ids] of pending) {
                await res.readHeld(entity, [...ids], byClass, next, transaction);
            }
            pending = next;
        }
        return res;
    }

    /**
     * The ids of the rows of an entity that are held.
     * @param entity - The entity.
     * @returns The ids.
     */
    getIds(entity: TenantRowsEntity): string[] {
        return [...this.held.get(entity)?.rows.keys() ?? []];
    }

    /**
     * Whether a row is held, which writes it over in place.
     * @param entity - Its entity.
     * @param id - Its id.
     * @returns Whether it is.
     */
    isHeld(entity: TenantRowsEntity, id: string): boolean {
        return this.held.get(entity)?.rows.has(id) === true;
    }

    /**
     * Takes note of one row of the backup: of a held row that the backup holds it, and of a held row taking
     * up a value of a unique that this one takes up.
     * @param entity - The entity of the row.
     * @param row - The row, as the backup holds it.
     */
    observe(entity: TenantRowsEntity, row: DeepPartial<BaseEntity>): void {
        const held: TenantRowsHeldEntity | undefined = this.held.get(entity);
        if (held == undefined) {
            return;
        }
        const id: string = String(row.id);
        const own: TenantRowsHeldRow | undefined = held.rows.get(id);
        if (own != undefined) {
            own.inBackup = true;
        }
        for (const [index, group] of held.uniques.entries()) {
            const taken: string | undefined = this.resolveTaken(held, group, row);
            if (taken != undefined) {
                this.markContested(held.takers[index]?.get(taken) ?? [], index, taken, id);
            }
        }
    }

    /**
     * Resolves what is written to the held rows before any row of the backup is: their stand-ins, and of a
     * kept one that it is soft deleted. Once every row of the backup is observed.
     * @param stamp - The mark a text stand-in carries.
     * @param readRows - Reads the rows of the backup again, which finding stand-ins no row holds needs.
     * @returns The values to write, by entity, each with the id of its row.
     * @throws When a contested value has no stand-in.
     */
    async resolveWritesBefore(stamp: string, readRows: TenantRowsReader): Promise<Map<TenantRowsEntity, DeepPartial<BaseEntity>[]>> {
        const standIns: TenantRowsStandIn[] = this.resolveStandIns(stamp);
        await this.findStandInValues(standIns, stamp, readRows);
        const byRow: Map<TenantRowsHeldRow, TenantRowsStandIn[]> = new Map();
        for (const standIn of standIns) {
            byRow.set(standIn.row, [...byRow.get(standIn.row) ?? [], standIn]);
        }
        const res: Map<TenantRowsEntity, DeepPartial<BaseEntity>[]> = new Map();
        for (const held of this.held.values()) {
            const writes: DeepPartial<BaseEntity>[] = this.resolveWritesBeforeOf(held, byRow);
            if (writes.length) {
                res.set(held.entity, writes);
            }
        }
        return res;
    }

    /**
     * Describes the rows kept, and the values they gave up, by entity: their ids and properties, never
     * their values.
     * @returns The descriptions, one per entity with a kept row.
     */
    describeKept(): string[] {
        return [...this.held.values()].flatMap(held => {
            const kept: TenantRowsHeldRow[] = [...held.rows.values()].filter(row => !row.inBackup);
            if (!kept.length) {
                return [];
            }
            const describe: (row: TenantRowsHeldRow) => string = row => row.givenUp.length
                ? `${row.id} (a stand-in for its ${row.givenUp.join(', ')})`
                : row.id;
            const deleted: string = held.softDeletes ? ', soft deleted' : '';
            return [`"${held.entity.metadata.tableName}"${deleted}: ${kept.map(describe).join(', ')}`];
        });
    }

    /**
     * Takes note of the held rows that take up a value of a unique another row of the backup takes up.
     * @param takers - The held rows taking up the value, as stored or once kept.
     * @param index - The unique.
     * @param taken - The value.
     * @param id - The id of the row of the backup.
     */
    private markContested(takers: TenantRowsHeldRow[], index: number, taken: string, id: string): void {
        for (const taker of takers) {
            if (taker.id === id) {
                continue;
            }
            if (taker.taken[index] === taken) {
                taker.contested.add(index);
            }
            if (taker.takenKept[index] === taken) {
                taker.contestedKept.add(index);
            }
        }
    }

    /**
     * Resolves what is written to the held rows of one entity before any row of the backup is.
     * @param held - The entity.
     * @param byRow - The stand-ins, by row.
     * @returns The values to write, each with the id of its row.
     */
    private resolveWritesBeforeOf(
        held: TenantRowsHeldEntity,
        byRow: Map<TenantRowsHeldRow, TenantRowsStandIn[]>
    ): DeepPartial<BaseEntity>[] {
        const writes: DeepPartial<BaseEntity>[] = [];
        for (const row of held.rows.values()) {
            const write: DeepPartial<BaseEntity> = { id: row.id };
            for (const standIn of byRow.get(row) ?? []) {
                Reflect.set(write, standIn.property, standIn.found?.value);
            }
            const softDeleted: boolean = !row.inBackup && held.softDeletes && !row.deleted;
            if (softDeleted) {
                // deleted on its own, not along with another row a recovery of which recovers it
                Reflect.set(write, 'deleted', true);
                Reflect.set(write, 'deletedWith', null);
            }
            if (softDeleted || byRow.has(row)) {
                writes.push(write);
            }
        }
        return writes;
    }

    /**
     * Finds the rows of the tenant that rows outside the backup point at: of an entity the backup leaves out,
     * with a key or join rows of its own.
     * @param byClass - The entities the backup covers.
     * @param tenantId - The tenant.
     * @param transaction - The transaction of the restore.
     * @returns The ids pointed at, by entity, of every tenant: reading them narrows them to this one.
     */
    private async findReferencedFromOutside(
        byClass: Map<Newable<BaseEntity>, TenantRowsEntity>,
        tenantId: string,
        transaction: Transaction | undefined
    ): Promise<Map<TenantRowsEntity, Set<string>>> {
        const res: Map<TenantRowsEntity, Set<string>> = new Map();
        for (const entityClass of this.dataSource.entities.filter(e => !byClass.has(e))) {
            const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
            if (metadata == undefined) {
                continue;
            }
            // rows of another tenant point at none of this one's
            const where: Where<BaseEntity> | undefined = TenantUtilities.resolveRowsOf(entityClass, metadata, tenantId);
            const repository: Repository<BaseEntity> = this.dataSource.getRepository(entityClass);
            for (const [key, property] of ObjectUtilities.entries(MetadataUtilities.getModelProperties(entityClass))) {
                const target: TenantRowsEntity | undefined = isRelationMetadata(property) ? byClass.get(property.target()) : undefined;
                if (target == undefined || !isRelationMetadata(property)) {
                    continue;
                }
                const ids: Set<string> = res.get(target) ?? new Set();
                res.set(target, ids);
                await this.addReferencedIds(ids, repository, key, property, where, transaction);
            }
        }
        return new Map([...res].filter(([, ids]) => ids.size));
    }

    /**
     * Adds the ids of the rows the rows of an entity point at through one relation, with a key or join rows
     * of their own.
     * @param ids - Collects the ids.
     * @param repository - The repository of the entity.
     * @param key - The relation.
     * @param property - The metadata of the relation.
     * @param where - The rows of the tenant, if the entity narrows them.
     * @param transaction - The transaction of the restore.
     */
    private async addReferencedIds(
        ids: Set<string>,
        repository: Repository<BaseEntity>,
        key: string,
        property: RelationMetadata<BaseEntity>,
        where: Where<BaseEntity> | undefined,
        transaction: Transaction | undefined
    ): Promise<void> {
        if (property.type === Relation.MANY_TO_ONE || property.type === Relation.BELONGS_TO_ONE) {
            for (const id of await repository.resolveDistinctAsStored(property.joinColumn, where, transaction)) {
                ids.add(String(id));
            }
        }
        else if (property.type === Relation.MANY_TO_MANY && property.persistence && property.joinTable !== false) {
            for await (const row of repository.streamAsStored(where ?? {}, { [key]: true }, transaction)) {
                for (const id of this.resolveIdsOf(Reflect.get(row, key))) {
                    ids.add(id);
                }
            }
        }
    }

    /**
     * Reads the held rows of an entity that are not read yet, and takes note of what they point at.
     * @param entity - The entity.
     * @param ids - The ids of the rows, of any tenant: those of another one are not read.
     * @param byClass - The entities the backup covers.
     * @param next - Collects, by entity, the ids of the rows the read ones point at.
     * @param transaction - The transaction of the restore.
     */
    private async readHeld(
        entity: TenantRowsEntity,
        ids: string[],
        byClass: Map<Newable<BaseEntity>, TenantRowsEntity>,
        next: Map<TenantRowsEntity, Set<string>>,
        transaction: Transaction | undefined
    ): Promise<void> {
        const held: TenantRowsHeldEntity = this.resolveHeldEntity(entity);
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entity.entityClass);
        const relations: Record<string, boolean> = Object.fromEntries(entity.joined.map(key => [key, true]));
        for (const chunk of PromiseUtilities.resolveChunks(ids.filter(id => !held.rows.has(id)), IDS_PER_READ)) {
            const scoped: ScopedWhere<BaseEntity> = ScopeWhereUtilities.applyToWhere(entity.where, { id: { oneOf: chunk } }, properties);
            if (scoped.matchesNothing) {
                continue;
            }
            const repository: Repository<BaseEntity> = this.dataSource.getRepository(entity.entityClass);
            for await (const row of repository.streamAsStored(scoped.where ?? {}, relations, transaction)) {
                this.addHeld(held, row);
                for (const [target, id] of this.resolveTargetsOf(entity, row, byClass)) {
                    if (!this.isHeld(target, id)) {
                        next.set(target, (next.get(target) ?? new Set()).add(id));
                    }
                }
            }
        }
    }

    /**
     * The rows of covered entities a row points at, with a key or join rows of its own.
     * @param entity - The entity of the row.
     * @param row - The row, as stored, with its join rows.
     * @param byClass - The entities the backup covers.
     * @returns Each entity and id pointed at.
     */
    private resolveTargetsOf(
        entity: TenantRowsEntity,
        row: BaseEntity,
        byClass: Map<Newable<BaseEntity>, TenantRowsEntity>
    ): [TenantRowsEntity, string][] {
        const properties: [string, PropertyMetadata][] = ObjectUtilities.entries(MetadataUtilities.getModelProperties(entity.entityClass));
        return properties.flatMap(([key, property]): [TenantRowsEntity, string][] => {
            const target: TenantRowsEntity | undefined = isRelationMetadata(property) ? byClass.get(property.target()) : undefined;
            if (target == undefined || !isRelationMetadata(property)) {
                return [];
            }
            if (property.type === Relation.MANY_TO_ONE || property.type === Relation.BELONGS_TO_ONE) {
                const id: unknown = Reflect.get(row, property.joinColumn);
                // a key is a string or a number, whose String is the id
                // eslint-disable-next-line typescript/no-base-to-string
                return id == undefined ? [] : [[target, String(id)]];
            }
            return entity.joined.includes(key) ? this.resolveIdsOf(Reflect.get(row, key)).map(id => [target, id]) : [];
        });
    }

    private resolveIdsOf(related: unknown): string[] {
        return Array.isArray(related)
            ? related.flatMap((r: unknown) => typeof r === 'object' && r != undefined && 'id' in r ? [String(r.id)] : [])
            : [];
    }

    private resolveHeldEntity(entity: TenantRowsEntity): TenantRowsHeldEntity {
        const known: TenantRowsHeldEntity | undefined = this.held.get(entity);
        if (known != undefined) {
            return known;
        }
        const uniques: UniqueGroup[] = ModelRegistry.get(entity.entityClass).keyDescriptor.uniques;
        const held: TenantRowsHeldEntity = {
            entity,
            uniques,
            softDeletes: isSoftDeleteEntityNewable(entity.entityClass),
            rows: new Map(),
            takers: uniques.map(() => new Map<string, TenantRowsHeldRow[]>()),
            values: new Map()
        };
        this.held.set(entity, held);
        return held;
    }

    private addHeld(held: TenantRowsHeldEntity, row: BaseEntity): void {
        const kept: DeepPartial<BaseEntity> = held.softDeletes ? Object.assign({}, row, { deleted: true }) : row;
        const named: string[] = [...new Set(held.uniques.flatMap(group => group.properties))];
        const heldRow: TenantRowsHeldRow = {
            id: String(row.id),
            taken: held.uniques.map(group => this.resolveTaken(held, group, row)),
            takenKept: held.uniques.map(group => this.resolveTaken(held, group, kept)),
            values: Object.fromEntries(named.map(property => [property, Reflect.get(row, property)])),
            deleted: Reflect.get(row, 'deleted') === true,
            inBackup: false,
            contested: new Set(),
            contestedKept: new Set(),
            givenUp: []
        };
        held.rows.set(heldRow.id, heldRow);
        for (const [index, takers] of held.takers.entries()) {
            for (const taken of new Set([heldRow.taken[index], heldRow.takenKept[index]])) {
                if (taken != undefined) {
                    takers.set(taken, [...takers.get(taken) ?? [], heldRow]);
                }
            }
        }
    }

    /**
     * What a row takes up of a unique: the values it holds of its properties, encoded together.
     * @param held - The entity of the row.
     * @param group - The unique.
     * @param row - The row, as stored.
     * @returns The values, or undefined when the unique leaves the row out or the row holds no value of one
     * of them, which takes up nothing.
     */
    private resolveTaken(held: TenantRowsHeldEntity, group: UniqueGroup, row: DeepPartial<BaseEntity>): string | undefined {
        if (group.where != undefined && !this.evaluator.matches<DeepPartial<BaseEntity>>(row, group.where, held.entity.entityClass)) {
            return undefined;
        }
        const values: (string | undefined)[] = group.properties.map(
            property => TenantRowsStandInUtilities.encode(Reflect.get(row, property))
        );
        return values.includes(undefined) ? undefined : JSON.stringify(values);
    }

    /**
     * Chooses, for each held row taking up a value of a unique that the backup gives another row, a property
     * of that unique to give up for a stand-in: the one whose stand-in keeps most of its value.
     * @param stamp - The mark a text stand-in carries.
     * @returns The values to give up.
     * @throws When none of the properties of such a unique can hold another value.
     */
    private resolveStandIns(stamp: string): TenantRowsStandIn[] {
        const res: TenantRowsStandIn[] = [];
        for (const held of this.held.values()) {
            const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(held.entity.entityClass);
            const references: Set<string> = new Set(Object.values(properties).flatMap(p => isRelationMetadata(p)
                && (p.type === Relation.MANY_TO_ONE || p.type === Relation.BELONGS_TO_ONE)
                ? [p.joinColumn]
                : []));
            const tenantProperty: string | undefined = TenantUtilities
                .resolveOwnership(held.entity.entityClass, held.entity.metadata)
                ?.property;
            for (const row of held.rows.values()) {
                res.push(...this.resolveStandInsOfRow(held, row, properties, references, tenantProperty, stamp));
            }
        }
        return res;
    }

    /**
     * Chooses, for each unique a held row takes up a value of that the backup gives another row, a property
     * of that unique to give up for a stand-in.
     * @param held - The entity of the row.
     * @param row - The row.
     * @param properties - The properties of the entity.
     * @param references - The properties holding the key of a relation.
     * @param tenantProperty - The property naming the tenant of a row, if any, which is never given up.
     * @param stamp - The mark a text stand-in carries.
     * @returns The values to give up.
     * @throws When none of the properties of such a unique can hold another value.
     */
    private resolveStandInsOfRow(
        held: TenantRowsHeldEntity,
        row: TenantRowsHeldRow,
        properties: Record<string, PropertyMetadata>,
        references: Set<string>,
        tenantProperty: string | undefined,
        stamp: string
    ): TenantRowsStandIn[] {
        const res: TenantRowsStandIn[] = [];
        const given: Set<string> = new Set();
        for (const index of [...row.inBackup ? row.contested : row.contestedKept].sort((a, b) => a - b)) {
            const group: UniqueGroup | undefined = held.uniques[index];
            // a property given up already holds a value no row holds, which no row takes up with it
            if (group == undefined || group.properties.some(p => given.has(p))) {
                continue;
            }
            const choice: [string, TenantRowsStandInKind] | undefined = this.findStandInChoice(
                group,
                properties,
                references,
                tenantProperty,
                stamp
            );
            if (choice == undefined) {
                throw new InternalError(
                    `The row "${row.id}" of "${held.entity.metadata.tableName}" holds a value of (${group.properties.join(', ')}) that the`
                    + ' backup gives to another row, and none of these can hold another value.'
                );
            }
            const [property, kind] = choice;
            const metadata: PropertyMetadata | undefined = properties[property];
            given.add(property);
            row.givenUp.push(property);
            res.push({
                held,
                row,
                property,
                kind,
                original: row.values[property],
                maxLength: metadata?.type === 'string' ? metadata.maxLength : undefined
            });
        }
        return res;
    }

    /**
     * Finds the property of a unique to give up for a stand-in: the one whose stand-in keeps most of its value.
     * @param group - The unique.
     * @param properties - The properties of its entity.
     * @param references - The properties holding the key of a relation.
     * @param tenantProperty - The property naming the tenant of a row, if any, which is never given up.
     * @param stamp - The mark a text stand-in carries.
     * @returns The property with the kind of its stand-in, or undefined when none can hold another value.
     */
    private findStandInChoice(
        group: UniqueGroup,
        properties: Record<string, PropertyMetadata>,
        references: Set<string>,
        tenantProperty: string | undefined,
        stamp: string
    ): [string, TenantRowsStandInKind] | undefined {
        const choices: [string, TenantRowsStandInKind][] = group.properties.flatMap((p): [string, TenantRowsStandInKind][] => {
            const property: PropertyMetadata | undefined = properties[p];
            const kind: TenantRowsStandInKind | undefined = property == undefined || p === tenantProperty
                ? undefined
                : TenantRowsStandInUtilities.findKind(property, references.has(p), stamp);
            return kind == undefined ? [] : [[p, kind]];
        });
        const [choice] = choices.sort(([, a], [, b]) => TenantRowsStandInUtilities.compareKinds(a, b));
        return choice;
    }

    /**
     * Finds for each value given up a stand-in that no row holds in its property: no held row, no other
     * stand-in and no row of the backup, which takes as many reads of it as rounds of candidates.
     * @param standIns - The values given up.
     * @param stamp - The mark a text stand-in carries.
     * @param readRows - Reads the rows of the backup again.
     * @throws When a value finds no stand-in.
     */
    private async findStandInValues(standIns: TenantRowsStandIn[], stamp: string, readRows: TenantRowsReader): Promise<void> {
        const chosen: Map<TenantRowsHeldEntity, Map<string, Set<string>>> = new Map();
        const choose: (standIn: TenantRowsStandIn, value: unknown) => void = (standIn, value) => {
            standIn.found = { value };
            const encoded: string | undefined = TenantRowsStandInUtilities.encode(value);
            if (encoded != undefined) {
                const byProperty: Map<string, Set<string>> = chosen.get(standIn.held) ?? new Map<string, Set<string>>();
                byProperty.set(standIn.property, (byProperty.get(standIn.property) ?? new Set()).add(encoded));
                chosen.set(standIn.held, byProperty);
            }
        };
        // nothing holds no value, and a new uuid is held by no row
        for (const standIn of standIns.filter(s => s.kind === 'null' || s.kind === 'uuid')) {
            choose(standIn, TenantRowsStandInUtilities.resolveCandidate(standIn.kind, standIn.original, 0, stamp, standIn.maxLength));
        }
        let open: TenantRowsStandIn[] = standIns.filter(s => s.found == undefined);
        for (let attempt: number = 0; open.length; attempt += CANDIDATES_PER_READ) {
            if (attempt >= MAX_CANDIDATES) {
                const [first] = open;
                throw new InternalError(
                    `The row "${first?.row.id}" of "${first?.held.entity.metadata.tableName}" holds a value of `
                    + `"${first?.property}" that the`
                    + ` backup gives to another row, and none of ${MAX_CANDIDATES} values to hold instead is free.`
                );
            }
            const candidates: Map<TenantRowsStandIn, unknown[]> = new Map(open.map(standIn => [
                standIn, Array
                    .from({ length: CANDIDATES_PER_READ }, (_, i) => TenantRowsStandInUtilities
                        .resolveCandidate(standIn.kind, standIn.original, attempt + i, stamp, standIn.maxLength))
                    .filter(value => value !== undefined)
            ]));
            const taken: Map<TenantRowsEntity, Map<string, Set<string>>> = await this.findTakenInBackup(candidates, readRows);
            for (const [standIn, values] of candidates) {
                const value: unknown = values.find(v => {
                    const encoded: string = TenantRowsStandInUtilities.encode(v) ?? '';
                    return taken.get(standIn.held.entity)?.get(standIn.property)
                        ?.has(encoded) !== true
                        && !this.resolveValuesHeld(standIn.held, standIn.property).has(encoded)
                        && chosen.get(standIn.held)?.get(standIn.property)
                            ?.has(encoded) !== true;
                });
                if (value !== undefined) {
                    choose(standIn, value);
                }
            }
            open = open.filter(s => s.found == undefined);
        }
    }

    /**
     * Finds which of the candidates a row of the backup holds.
     * @param candidates - The candidates of each value given up.
     * @param readRows - Reads the rows of the backup again.
     * @returns The candidates held, encoded, by entity and property.
     */
    private async findTakenInBackup(
        candidates: Map<TenantRowsStandIn, unknown[]>,
        readRows: TenantRowsReader
    ): Promise<Map<TenantRowsEntity, Map<string, Set<string>>>> {
        const asked: Map<TenantRowsEntity, Map<string, Set<string>>> = new Map();
        for (const [standIn, values] of candidates) {
            const byProperty: Map<string, Set<string>> = asked.get(standIn.held.entity) ?? new Map<string, Set<string>>();
            const encoded: Set<string> = byProperty.get(standIn.property) ?? new Set();
            for (const value of values) {
                encoded.add(TenantRowsStandInUtilities.encode(value) ?? '');
            }
            byProperty.set(standIn.property, encoded);
            asked.set(standIn.held.entity, byProperty);
        }
        const res: Map<TenantRowsEntity, Map<string, Set<string>>> = new Map();
        for await (const [entity, row] of readRows()) {
            for (const [property, encoded] of asked.get(entity) ?? []) {
                const value: string | undefined = TenantRowsStandInUtilities.encode(Reflect.get(row, property));
                if (value != undefined && encoded.has(value)) {
                    const byProperty: Map<string, Set<string>> = res.get(entity) ?? new Map<string, Set<string>>();
                    byProperty.set(property, (byProperty.get(property) ?? new Set()).add(value));
                    res.set(entity, byProperty);
                }
            }
        }
        return res;
    }

    private resolveValuesHeld(held: TenantRowsHeldEntity, property: string): Set<string> {
        const known: Set<string> | undefined = held.values.get(property);
        if (known != undefined) {
            return known;
        }
        const values: Set<string> = new Set([...held.rows.values()].flatMap(row => {
            const encoded: string | undefined = TenantRowsStandInUtilities.encode(row.values[property]);
            return encoded == undefined ? [] : [encoded];
        }));
        held.values.set(property, values);
        return values;
    }
}