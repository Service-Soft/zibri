import { RemovalReach } from './removal-reach.model';
import { DriverAggregateOptions, DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface, STREAM_BATCH_SIZE } from './repository-driver.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata, RelationMetadata } from '../../entity/decorators/property.decorator';
import { EntityOrderUtilities, OrderKey } from '../../entity/models/entity-order.utilities';
import { RelationTree } from '../../entity/models/entity-relations.model';
import { EntityRelationsUtilities } from '../../entity/models/entity-relations.utilities';
import { SelectionTree } from '../../entity/models/entity-selection.utilities';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { Relation } from '../../entity/models/relation.enum';
import { coversEveryRow, UniqueGroup } from '../../entity/models/unique-declaration.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { toJsonValue } from '../../parsing/functions/to-json-value.function';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { type PostgresDataSource } from '../data-sources/postgres/postgres-data-source.model';
import { PostgresParameters } from '../data-sources/postgres/postgres-parameters.model';
import { PostgresSchema } from '../data-sources/postgres/postgres-schema.model';
import { PostgresSelect } from '../data-sources/postgres/postgres-select.model';
import { PostgresSqlUtilities } from '../data-sources/postgres/postgres-sql.utilities';
import { PostgresColumn, PostgresRelationJoin, PostgresTable } from '../data-sources/postgres/postgres-table.model';
import { PostgresWhereFilterConverter } from '../data-sources/postgres/postgres-where-filter.converter';
import { ParameterizedSql } from '../data-sources/where-converter/parameterized-sql.model';
import { AggregateRow } from '../models/aggregate.model';
import { FindAllOptions } from '../models/options/find-all-options.model';
import { PaginationResult } from '../models/pagination-result.model';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';
import { UnboundedReturnError } from '../unbounded-return.error';
import { uniqueConstraintName } from '../unique-constraint-name.function';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';
import { UpsertIdentityUtilities } from '../upsert-identity.utilities';
import { keyWhereToSql } from '../where/key-where-to-sql.function';
import { WriteDataUtilities } from '../write-data.utilities';

/**
 * The alias the rows of the entity are read and written under.
 */
const ROW: string = 'zi_row';

/**
 * The name a page's total is selected under, next to the rows of the page.
 */
const TOTAL_SELECTION: string = 'zi_total';

/**
 * The name a value taken over rows is selected under.
 */
const AGGREGATE_SELECTION: string = 'zi_value';

/**
 * The prefix of the names the values a group of rows shares are selected under.
 */
const GROUP_SELECTION: string = 'zi_group_';

/**
 * A relation a read joins, and the relations joined below it.
 */
type JoinedRelation = {
    /**
     * The relation's property.
     */
    property: string,
    /**
     * The alias its rows are read under.
     */
    alias: string,
    /**
     * Its entity.
     */
    entityClass: Newable<BaseEntity>,
    /**
     * Whether it holds a list of rows.
     */
    toMany: boolean,
    /**
     * The relations joined below it.
     */
    below: JoinedRelation[]
};

/**
 * A read, built: the statement, and the relations it joins.
 */
type BuiltRead = {
    /**
     * The statement.
     */
    select: PostgresSelect,
    /**
     * The relations it joins.
     */
    joined: JoinedRelation[]
};

/**
 * The values a row writes to the columns of its own table, by column.
 */
type ColumnValues = Map<string, unknown>;

/**
 * The repository driver that reads and writes the entities of a postgres data source.
 */
export class PostgresRepositoryDriver<T extends BaseEntity> implements RepositoryDriverInterface<T> {

    private readonly properties: Record<string, PropertyMetadata>;

    private readonly table: PostgresTable;

    constructor(
        private readonly entityClass: Newable<T>,
        private readonly dataSource: PostgresDataSource,
        private readonly schema: PostgresSchema,
        private readonly converter: PostgresWhereFilterConverter,
        private readonly maxBoundValuesPerStatement: number
    ) {
        this.properties = MetadataUtilities.getModelProperties(entityClass);
        this.table = schema.getTable(entityClass);
    }

    // ── reads ───────────────────────────────────────────────────

    // eslint-disable-next-line jsdoc/require-jsdoc
    async find(options: DriverFindOptions<T>): Promise<T[]> {
        const read: BuiltRead = this.buildRead(options, options.offset, options.limit);
        return this.hydrate(await this.run(read.select.build(), options.transaction), read.joined);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRelations(
        entities: T[],
        relations: FindAllOptions<T>['relations'],
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined
    ): Promise<T[]> {
        if (!entities.length) {
            return [];
        }
        // read again with them, since a relation is read in the statement that reads its row: that is
        // one statement, as resolving them on their own would be
        const read: T[] = await this.find({ where: this.byIds(entities.map(e => e.id)), relations, related, transaction });
        // paired by id rather than by position: nothing says a select answers in the order of its list
        const byId: Map<T['id'], T> = new Map(read.map(r => [r.id, r]));
        return entities.map(entity => {
            const found: T | undefined = byId.get(entity.id);
            if (found == undefined) {
                throw new InternalError(`Reading the relations of "${this.entityClass.name}" found no row with id "${entity.id}".`);
            }
            return found;
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        return (await this.find({ ...options, offset: undefined, limit: 1 })).at(0);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async count(options: DriverFindOptions<T>): Promise<number> {
        const select: PostgresSelect = this.filtered(options.where, options.related).select(`COUNT(*) AS "${TOTAL_SELECTION}"`);
        const [row] = await this.run(select.build(), options.transaction);
        return Number(row?.[TOTAL_SELECTION] ?? 0);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async aggregate(options: DriverAggregateOptions<T>): Promise<AggregateRow[]> {
        const select: PostgresSelect = this.filtered(options.where, options.related)
            .select(`${this.aggregateExpression(options)} AS "${AGGREGATE_SELECTION}"`);
        for (const [i, key] of options.groupBy.entries()) {
            const column: string = this.qualify(ROW, key);
            select.select(`${column} AS "${GROUP_SELECTION}${i}"`).groupBy(column);
        }
        const raw: Record<string, unknown>[] = await this.run(select.build(), options.transaction);
        // one row however many matched when nothing groups them, null over no rows: the same answer
        // as no row, which is what a store answering in process gives
        if (!options.groupBy.length && raw.length === 1 && raw[0]?.[AGGREGATE_SELECTION] == undefined && options.fn !== 'count') {
            return [];
        }
        return raw.map(row => ({
            group: Object.fromEntries(options.groupBy.map((key, i) => [key, row[`${GROUP_SELECTION}${i}`] ?? undefined])),
            value: row[AGGREGATE_SELECTION] ?? undefined
        }));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        // the total selected next to the rows of the page, so that one statement answers both. A
        // statement reads one moment, which is what a page and its total have to describe
        const read: BuiltRead = this.buildRead(options, options.offset, options.limit);
        const counting: PostgresSelect = this.filtered(options.totalWhere ?? options.where, options.related).select('COUNT(*)');
        const total: ParameterizedSql = counting.build();
        read.select.select({ sql: `(${total.sql}) AS "${TOTAL_SELECTION}"`, parameters: total.parameters });
        const rows: Record<string, unknown>[] = await this.run(read.select.build(), options.transaction);
        const counted: unknown = rows[0]?.[TOTAL_SELECTION];
        return {
            items: this.hydrate(rows, read.joined),
            // a page holding no rows carries no total with it: past the last page, or after the last
            // row of a walk. The one case the total is a round trip of its own
            totalAmount: counted == undefined
                ? await this.count({ ...options, where: options.totalWhere ?? options.where })
                : Number(counted)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIds(options: DriverFindOptions<T>): Promise<string[]> {
        const select: PostgresSelect = this.filtered(options.where, options.related).select(this.qualify(ROW, 'id'));
        this.order(select, options.order, options.related);
        select.window(options.offset, options.limit);
        return (await this.run(select.build(), options.transaction)).map(row => String(row['id']));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        // the cursor carries ids and nothing else, and the rows are read back in batches through the
        // same `find` every other read uses, which reads relations as well. What the cursor decides is
        // which rows, fixed when the query runs, where paging re-asks the question on every page. An
        // order goes into the cursor as well, so it decides once in which order the rows come too
        const select: PostgresSelect = this.filtered(options.where, options.related).select(this.qualify(ROW, 'id'));
        this.order(select, options.order, options.related);
        let ids: string[] = [];
        for await (const row of this.dataSource.streamStatement(select.build(), options.transaction)) {
            ids.push(String(row['id']));
            if (ids.length < STREAM_BATCH_SIZE) {
                continue;
            }
            yield* await this.streamBatch(ids, options);
            ids = [];
        }
        if (ids.length) {
            yield* await this.streamBatch(ids, options);
        }
    }

    /**
     * Reads one batch of the streamed ids back as entities, in the order the cursor gave them.
     * @param ids - The ids to read, in the order they were streamed.
     * @param options - The stream options, for the relations to resolve and the transaction to read in.
     * @returns The entities, in the order their ids were streamed.
     */
    private async streamBatch(ids: string[], options: DriverStreamOptions<T>): Promise<T[]> {
        const found: T[] = await this.find({ ...options, where: this.byIds(ids), order: undefined });
        const byId: Map<string, T> = new Map(found.map(entity => [String(entity.id), entity]));
        // a row the cursor named and the read did not find was deleted in between, which a stream
        // over a moving table is allowed to miss
        return ids.map(id => byId.get(id)).filter((entity): entity is T => entity != undefined);
    }

    /**
     * Builds a read: the rows a filter matches, in its order and window, with the relations it asks
     * for joined - each narrowed to the rows the caller may see of its entity. One statement however
     * deep the relations go.
     * @param options - The read's options.
     * @param offset - How many rows the window passes over.
     * @param limit - How many rows it holds.
     * @returns The statement, and the relations it joins.
     */
    private buildRead(options: DriverFindOptions<T>, offset: number | undefined, limit: number | undefined): BuiltRead {
        const select: PostgresSelect = this.filtered(options.where, options.related);
        this.selectColumns(select, ROW, this.entityClass, options.select);
        const joined: JoinedRelation[] = this.joinRelations(
            select,
            ROW,
            this.entityClass,
            EntityRelationsUtilities.resolveTree(options.relations),
            options.related,
            options.select
        );
        this.order(select, options.order, options.related);
        if (offset == undefined && limit == undefined) {
            return { select, joined };
        }
        if (!this.joinsMany(joined)) {
            select.window(offset, limit);
            return { select, joined };
        }
        // a row joined with three related rows is three rows to a window, so the window is taken over
        // the ids of the rows alone, and the rows with everything joined are the ones among them.
        // Still one statement, which keeps a page and its total in one moment
        const ids: PostgresSelect = this.filtered(options.where, options.related).select(this.qualify(ROW, 'id'));
        this.order(ids, options.order, options.related);
        const page: ParameterizedSql = ids.window(offset, limit).build();
        select.where({ sql: `${this.qualify(ROW, 'id')} IN (${page.sql})`, parameters: page.parameters });
        return { select, joined };
    }

    /**
     * Starts a statement over the rows a filter matches.
     * @param where - The filter.
     * @param related - What the rows of each entity it reaches through a relation are narrowed to.
     * @returns The statement.
     */
    private filtered(where: Where<T> | undefined, related: RelatedNarrowing | undefined): PostgresSelect {
        const select: PostgresSelect = new PostgresSelect(this.table.name, ROW);
        if (where != undefined) {
            select.where(this.converter.convert(where, this.entityClass, ROW, related));
        }
        return select;
    }

    /**
     * Selects the columns of an entity's rows a read hands back, each under its alias, so that rows of
     * several entities can be told apart in one row of the result.
     * @param select - The statement.
     * @param alias - The alias the rows are read under.
     * @param entityClass - The entity.
     * @param selection - What the read selects at this level, undefined for whole rows.
     */
    private selectColumns(
        select: PostgresSelect,
        alias: string,
        entityClass: Newable<BaseEntity>,
        selection: SelectionTree | undefined
    ): void {
        const columns: PostgresColumn[] = this.schema.getTable(entityClass).columns
            .filter(c => c.property != undefined && (selection == undefined || c.property === 'id' || selection.has(c.property)));
        select.select(...columns.map(c => {
            const aliased: string = `${alias}.${c.name}`;
            return `${PostgresSqlUtilities.qualify(alias, c.name)} AS ${PostgresSqlUtilities.escapeIdentifier(aliased)}`;
        }));
    }

    /**
     * Joins the relations a read asks for, each narrowed to the rows the caller may see of its entity.
     * A read that selects joins only the relations its selection names.
     * @param select - The statement.
     * @param parentAlias - The alias of the rows the relations are read from.
     * @param entityClass - Their entity.
     * @param relations - The relations to join, and those to join below each.
     * @param related - What the rows each relation reaches are narrowed to.
     * @param selection - What the read selects at this level, undefined for whole rows.
     * @returns The relations joined.
     */
    private joinRelations(
        select: PostgresSelect,
        parentAlias: string,
        entityClass: Newable<BaseEntity>,
        relations: RelationTree,
        related: RelatedNarrowing | undefined,
        selection: SelectionTree | undefined
    ): JoinedRelation[] {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(entityClass);
        const res: JoinedRelation[] = [];
        for (const [key, below] of relations) {
            const metadata: PropertyMetadata | undefined = properties[key];
            const selected: SelectionTree | true | undefined = selection?.get(key);
            if (!isRelationMetadata(metadata) || (selection != undefined && selected == undefined)) {
                continue;
            }
            const target: Newable<BaseEntity> = metadata.target();
            const alias: string = this.joinRelated(select, parentAlias, entityClass, key, related);
            const narrowed: SelectionTree | undefined = selected === true ? undefined : selected;
            this.selectColumns(select, alias, target, narrowed);
            res.push({
                property: key,
                alias,
                entityClass: target,
                toMany: metadata.type === Relation.ONE_TO_MANY || metadata.type === Relation.MANY_TO_MANY,
                below: this.joinRelations(select, alias, target, below, related, narrowed)
            });
        }
        return res;
    }

    /**
     * Joins the related rows of one relation, narrowed to the ones the caller may see.
     * @param select - The statement.
     * @param parentAlias - The alias of the rows the relation is read from.
     * @param entityClass - Their entity.
     * @param key - The relation's property.
     * @param related - What the rows each relation reaches are narrowed to.
     * @returns The alias the related rows are read under.
     * @throws When the property is no relation.
     */
    private joinRelated(
        select: PostgresSelect,
        parentAlias: string,
        entityClass: Newable<BaseEntity>,
        key: string,
        related: RelatedNarrowing | undefined
    ): string {
        const join: PostgresRelationJoin = this.schema.getJoin(entityClass, key);
        const metadata: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(entityClass)[key];
        if (!isRelationMetadata(metadata)) {
            throw new InternalError(`"${entityClass.name}.${key}" is no relation.`);
        }
        const alias: string = this.converter.createAlias('zi_j');
        const id: (of: string) => string = of => PostgresSqlUtilities.qualify(of, 'id');
        let on: string;
        switch (join.kind) {
            case 'key': {
                on = `${id(alias)} = ${PostgresSqlUtilities.qualify(parentAlias, join.column)}`;
                break;
            }
            case 'inverse': {
                on = `${PostgresSqlUtilities.qualify(alias, join.column)} = ${id(parentAlias)}`;
                break;
            }
            case 'junction': {
                const junction: string = this.converter.createAlias('zi_jt');
                select.leftJoin(join.junction, junction, `${PostgresSqlUtilities.qualify(junction, join.ownColumn)} = ${id(parentAlias)}`);
                on = `${id(alias)} = ${PostgresSqlUtilities.qualify(junction, join.targetColumn)}`;
                break;
            }
        }
        const narrowing: ParameterizedSql | undefined = this.converter.convertNarrowing(metadata.target(), alias, related);
        select.leftJoin(
            join.table,
            alias,
            narrowing == undefined ? on : { sql: `${on} AND (${narrowing.sql})`, parameters: narrowing.parameters }
        );
        return alias;
    }

    private joinsMany(joined: JoinedRelation[]): boolean {
        return joined.some(j => j.toMany || this.joinsMany(j.below));
    }

    /**
     * Orders a statement, joining the relations to one row an order reaches through.
     * @param select - The statement.
     * @param order - The order.
     * @param related - What the rows each relation reaches are narrowed to.
     * @throws When the order reaches through a property that is no relation.
     */
    private order(select: PostgresSelect, order: DriverFindOptions<T>['order'], related: RelatedNarrowing | undefined): void {
        const aliases: Map<string, string> = new Map();
        for (const key of EntityOrderUtilities.resolveKeys(order, this.entityClass)) {
            let alias: string = ROW;
            let entityClass: Newable<BaseEntity> = this.entityClass;
            for (const [i, property] of key.path.slice(0, -1).entries()) {
                const path: string = key.path.slice(0, i + 1).join('.');
                const metadata: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(entityClass)[property];
                if (!isRelationMetadata(metadata)) {
                    throw new InternalError(`The order names "${path}", which is no relation.`);
                }
                alias = aliases.get(path) ?? this.joinRelated(select, alias, entityClass, property, related);
                aliases.set(path, alias);
                entityClass = metadata.target();
            }
            const column: string = PostgresSqlUtilities.qualify(alias, this.schema.getColumn(entityClass, key.path.at(-1) ?? 'id').name);
            select.orderBy(this.orderExpression(key, column));
        }
    }

    private orderExpression(key: OrderKey, column: string): string | ParameterizedSql {
        if (key.similarTo == undefined) {
            return `${column} ${key.direction}`;
        }
        // a row holding no text is similar to nothing, and sorts after every row that holds some
        const similarity: ParameterizedSql = this.converter.similarityExpression(column, key.similarTo);
        return { sql: `${similarity.sql} DESC NULLS LAST`, parameters: similarity.parameters };
    }

    /**
     * Builds the entities out of the rows a read returned, each once however many rows it was joined
     * into, with the relations that were joined attached.
     * @param rows - The rows.
     * @param joined - The relations the read joined.
     * @returns The entities, in the order their first row came in.
     */
    private hydrate(rows: Record<string, unknown>[], joined: JoinedRelation[]): T[] {
        const entities: Map<string, T> = new Map();
        const children: WeakMap<object, Map<string, BaseEntity>> = new WeakMap();
        for (const row of rows) {
            const id: string = String(row[`${ROW}.id`]);
            let entity: T | undefined = entities.get(id);
            if (entity == undefined) {
                entity = this.schema.toEntities(this.entityClass, [row], `${ROW}.`)[0] ?? new this.entityClass();
                entities.set(id, entity);
            }
            this.attach(entity, row, joined, children);
        }
        return [...entities.values()];
    }

    /**
     * Attaches the rows of the relations a row of the result holds to the entity it belongs to.
     *
     * A relation to one row with no row joined stays unset rather than null - a row pointing at
     * nothing, or at a row the caller may not see, holds no related row, which is what every other
     * store hands back. A relation to many rows with none joined holds an empty list.
     * @param parent - The entity.
     * @param row - The row of the result.
     * @param joined - The relations joined below the entity.
     * @param children - The related rows attached so far, by the list they were attached to.
     */
    private attach(
        parent: object,
        row: Record<string, unknown>,
        joined: JoinedRelation[],
        children: WeakMap<object, Map<string, BaseEntity>>
    ): void {
        for (const relation of joined) {
            const id: unknown = row[`${relation.alias}.id`];
            if (!relation.toMany) {
                if (id == undefined) {
                    continue;
                }
                let child: unknown = Reflect.get(parent, relation.property);
                if (typeof child !== 'object' || child == undefined) {
                    child = this.schema.toEntities(relation.entityClass, [row], `${relation.alias}.`)[0];
                    Reflect.set(parent, relation.property, child);
                }
                this.attach(child as object, row, relation.below, children);
                continue;
            }
            let list: unknown = Reflect.get(parent, relation.property);
            if (!Array.isArray(list)) {
                list = [];
                Reflect.set(parent, relation.property, list);
            }
            // the key of every table is a uuid column, which is read as text
            if (typeof id !== 'string') {
                continue;
            }
            const attached: Map<string, BaseEntity> = children.get(list as object) ?? new Map<string, BaseEntity>();
            children.set(list as object, attached);
            let child: BaseEntity | undefined = attached.get(id);
            if (child == undefined) {
                child = this.schema.toEntities(relation.entityClass, [row], `${relation.alias}.`)[0] ?? new relation.entityClass();
                attached.set(id, child);
                (list as BaseEntity[]).push(child);
            }
            this.attach(child, row, relation.below, children);
        }
    }

    private aggregateExpression(options: DriverAggregateOptions<T>): string {
        const column: string = this.qualify(ROW, options.property ?? 'id');
        switch (options.fn) {
            case 'sum': {
                return `SUM(${column})`;
            }
            case 'average': {
                return `AVG(${column})`;
            }
            case 'minimum': {
                return `MIN(${column})`;
            }
            case 'maximum': {
                return `MAX(${column})`;
            }
            case 'count': {
                return 'COUNT(*)';
            }
        }
    }

    // ── writes ──────────────────────────────────────────────────

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        if (!data.length) {
            return [];
        }
        // a row holding the id of a stored one replaces the values it gives, as an update does
        const written: T[] = await this.write(data, transaction, 'replace');
        return reload ? written : [];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        return !data.length ? [] : await this.write(data, transaction, 'insert');
    }

    /**
     * Writes rows with as few statements as their bound values allow, together with the rows of the
     * join tables of their many to many relations.
     * @param data - The rows, each with its id.
     * @param transaction - The transaction to write in.
     * @param mode - Whether the rows are new, or may replace the values of stored ones holding their id.
     * @returns The rows as they were stored, in the order they were given, with the relations they gave.
     */
    private async write(data: DeepPartial<T>[], transaction: Transaction | undefined, mode: 'insert' | 'replace'): Promise<T[]> {
        const values: ColumnValues[] = data.map(row => this.resolveColumnValues(row));
        const columns: string[] = [...new Set(values.flatMap(v => [...v.keys()]))];
        // a row replacing a stored one keeps what it gives no value for, which a statement writing
        // several rows with the same columns cannot: the conflict would write the defaults of the others
        const rowsPerStatement: number = mode === 'replace' ? 1 : this.resolveRowsPerStatement(columns.length);
        const chunks: number[][] = PromiseUtilities.resolveChunks(data.map((_, i) => i), rowsPerStatement);
        const writeAll: (on: Transaction | undefined) => Promise<T[]> = async on => {
            const res: T[] = [];
            for (const chunk of chunks) {
                const rows: ColumnValues[] = chunk.map(i => values[i] ?? new Map<string, unknown>());
                const statementColumns: string[] = mode === 'replace' ? [...rows[0]?.keys() ?? []] : columns;
                res.push(...await this.writeInOneStatement(rows, statementColumns, on, mode));
            }
            await this.writeJunctionRows(data, on, mode === 'replace');
            return res;
        };
        // several statements are one write only inside one transaction
        const written: T[] = chunks.length > 1 || this.writesJunctionRows(data)
            ? await this.inTransaction(transaction, writeAll)
            : await writeAll(transaction);
        // by id rather than by position: nothing says a store returns the rows of a statement in the
        // order they went into it, and the caller pairs them with what it passed
        const byId: Map<string, T> = new Map(written.map(row => [String(row.id), row]));
        return data.map(row => {
            const entity: T | undefined = byId.get(String(row.id));
            if (entity == undefined) {
                throw new InternalError(`Writing "${this.entityClass.name}" returned no row with id "${String(row.id)}".`);
            }
            return this.withGivenRelations(entity, row);
        });
    }

    private async writeInOneStatement(
        rows: ColumnValues[],
        columns: string[],
        transaction: Transaction | undefined,
        mode: 'insert' | 'replace'
    ): Promise<T[]> {
        const [first] = rows;
        if (mode === 'replace' && rows.length === 1 && first?.has('id') === true) {
            return await this.replaceInOneStatement(first, transaction);
        }
        const parameters: PostgresParameters = this.converter.createParameters();
        // a column this row gives no value for is written the way inserting it alone would write it
        const tuples: string = rows
            .map(row => `(${columns.map(c => row.has(c) ? parameters.add(row.get(c)) : 'DEFAULT').join(', ')})`)
            .join(', ');
        const sql: string = `INSERT INTO ${this.escape(this.table.name)} (${columns.map(c => this.escape(c)).join(', ')})`
            + ` VALUES ${tuples} RETURNING *`;
        return this.schema.toEntities(this.entityClass, await this.run({ sql, parameters: parameters.values }, transaction));
    }

    /**
     * Writes a row that replaces the values it gives of the stored row holding its id, or is inserted
     * when there is none, in one statement.
     * @param row - The row, with its id.
     * @param transaction - The transaction to write in.
     * @returns The row as it was stored.
     */
    private async replaceInOneStatement(row: ColumnValues, transaction: Transaction | undefined): Promise<T[]> {
        // updated first and inserted only when nothing was, rather than an insert resolving a conflict
        // on the id: postgres checks the row it is asked to insert before it looks for the conflict, so
        // a row giving only some of its values failed on every required one it left out
        const parameters: PostgresParameters = this.converter.createParameters();
        const columns: string[] = [...row.keys()];
        const placeholders: Map<string, string> = new Map(columns.map(c => [c, parameters.add(row.get(c))]));
        const set: string = columns
            .filter(c => c !== 'id')
            .map(c => `${this.escape(c)} = ${placeholders.get(c)}`)
            .join(', ') || `${this.escape('id')} = ${placeholders.get('id')}`;
        // typed by hand, as a selected value takes no type from the column it is inserted into
        const selected: string = columns.map(c => `${placeholders.get(c)}::${this.resolveColumnType(c)}`).join(', ');
        const table: string = this.escape(this.table.name);
        const sql: string = `WITH "zi_updated" AS (UPDATE ${table} SET ${set}`
            + ` WHERE ${this.escape('id')} = ${placeholders.get('id')} RETURNING *),`
            + ` "zi_inserted" AS (INSERT INTO ${table} (${columns.map(c => this.escape(c)).join(', ')})`
            + ` SELECT ${selected} WHERE NOT EXISTS (SELECT 1 FROM "zi_updated") RETURNING *)`
            + ' SELECT * FROM "zi_updated" UNION ALL SELECT * FROM "zi_inserted"';
        return this.schema.toEntities(this.entityClass, await this.run({ sql, parameters: parameters.values }, transaction));
    }

    /**
     * The type a column is stored as, the way a value is cast to it.
     * @param name - The column's name.
     * @returns The type.
     * @throws When the table has no such column.
     */
    private resolveColumnType(name: string): string {
        const column: PostgresColumn | undefined = this.table.columns.find(c => c.name === name);
        if (column == undefined) {
            throw new InternalError(`The table "${this.table.name}" has no column "${name}".`);
        }
        return PostgresSchema.resolveFullType(column);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        const { where, data, increments, transaction, related, returnUpdated, returnAtMost }: DriverUpdateAllOptions<T, R> = options;
        // counted before the write, since the statement writes and hands back in one: a count reads no row
        if (returnAtMost != undefined && await this.count({ where, related, transaction }) > returnAtMost) {
            throw new UnboundedReturnError(this.entityClass.name, returnAtMost);
        }
        const writesJunctionRows: boolean = this.writesJunctionRows([data]);
        const update: (on: Transaction | undefined) => Promise<T[] | number> = async on => {
            const parameters: PostgresParameters = this.converter.createParameters();
            const set: string[] = this.resolveUpdateSet(data, increments, parameters);
            // a filter reaching through a relation is answered inside the statement, which reads its
            // rows under the same alias a select does. The statement selects, writes and reports the
            // rows it wrote, so nothing has to be held around it and the rows cannot move in between
            const condition: ParameterizedSql = where == undefined
                ? { sql: 'TRUE', parameters: {} }
                : this.converter.convert(where, this.entityClass, ROW, related);
            const statement: ParameterizedSql = {
                sql: `UPDATE ${this.escape(this.table.name)} AS ${this.escape(ROW)} SET ${set.join(', ')} WHERE ${condition.sql}`,
                parameters: { ...parameters.values, ...condition.parameters }
            };
            if (set.length && returnUpdated !== true && !writesJunctionRows) {
                // counted where the rows are, so that a write of a large table hands nothing back
                const [counted] = await this.run({
                    sql: `WITH "zi_updated" AS (${statement.sql} RETURNING 1) SELECT COUNT(*) AS "${TOTAL_SELECTION}" FROM "zi_updated"`,
                    parameters: statement.parameters
                }, on);
                return Number(counted?.[TOTAL_SELECTION] ?? 0);
            }
            const returning: string = writesJunctionRows ? this.qualify(ROW, 'id') : `${this.escape(ROW)}.*`;
            const written: Record<string, unknown>[] = set.length
                ? await this.run({
                    sql: `${statement.sql} RETURNING ${returning}`,
                    parameters: statement.parameters
                }, on)
                : await this.run(this.filtered(where, related).select(this.qualify(ROW, 'id'))
                    .lockRows()
                    .build(), on);
            if (!writesJunctionRows) {
                return returnUpdated === true ? this.schema.toEntities(this.entityClass, written) : written.length;
            }
            const ids: string[] = written.map(row => String(row['id']));
            await this.writeJunctionRows(ids.map(id => ({ ...data, id })), on, true);
            // read back by id rather than by the filter, which the update may have changed the answer of
            return returnUpdated === true ? await this.find({ where: this.byIds(ids), transaction: on }) : ids.length;
        };
        const updated: T[] | number = writesJunctionRows ? await this.inTransaction(transaction, update) : await update(transaction);
        return updated as R extends true ? T[] : number;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: Transaction | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        if (!rows.length) {
            return [];
        }
        const columns: number = this.table.columns.length + 2;
        const chunks: DeepPartial<T>[][] = PromiseUtilities.resolveChunks(rows, this.resolveRowsPerStatement(columns));
        const writeAll: (on: Transaction | undefined) => Promise<T[]> = async on => {
            const res: T[] = [];
            for (const chunk of chunks) {
                res.push(...await this.updateEachInOneStatement(chunk, where, on, related));
            }
            const written: Set<string> = new Set(res.map(r => String(r.id)));
            await this.writeJunctionRows(rows.filter(r => written.has(String(r.id))), on, true);
            return res;
        };
        const written: T[] = chunks.length > 1 || this.writesJunctionRows(rows)
            ? await this.inTransaction(transaction, writeAll)
            : await writeAll(transaction);
        const given: Map<string, DeepPartial<T>> = new Map(rows.map(r => [String(r.id), r]));
        return written.map(entity => this.withGivenRelations(entity, given.get(String(entity.id)) ?? {}));
    }

    /**
     * Writes each row's own values with one statement: every column some row gives a value for is set
     * to that row's value where the id is that row's, and kept as it is everywhere else.
     * @param rows - The values to write, no more than one statement binds.
     * @param where - The rows that may be written.
     * @param transaction - The transaction to run the statement in.
     * @param related - What the rows the filter reaches through a relation are narrowed to.
     * @returns The rows written, as they are stored now.
     */
    private async updateEachInOneStatement(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: Transaction | undefined,
        related: RelatedNarrowing | undefined
    ): Promise<T[]> {
        const parameters: PostgresParameters = this.converter.createParameters();
        const values: ColumnValues[] = rows.map(row => this.resolveColumnValues(row));
        const id: string = this.escape('id');
        const set: string[] = [];
        for (const column of this.table.columns.filter(c => c.name !== 'id' && values.some(v => v.has(c.name)))) {
            const own: string = this.escape(column.name);
            const branches: string[] = this.buildUpdateEachBranches(column, rows, values, parameters);
            set.push(`${own} = CASE ${this.escape(ROW)}.${id} ${branches.join(' ')} ELSE ${this.escape(ROW)}.${own} END`);
        }
        if (!set.length) {
            // nothing to set, so the rows as they stand
            return await this.find({ where, transaction, related });
        }
        const ids: string = parameters.addList(rows.map(r => r.id));
        const condition: ParameterizedSql = this.converter.convert(where, this.entityClass, ROW, related);
        return this.schema.toEntities(this.entityClass, await this.run({
            // the rows of this statement only, when the filter names the rows of several
            sql: `UPDATE ${this.escape(this.table.name)} AS ${this.escape(ROW)} SET ${set.join(', ')}`
                + ` WHERE ${condition.sql} AND ${this.escape(ROW)}.${id} = ANY(${ids}) RETURNING ${this.escape(ROW)}.*`,
            parameters: { ...parameters.values, ...condition.parameters }
        }, transaction));
    }

    /**
     * Builds the branches of the case that sets one column, one for each row giving it a value.
     * @param column - The column.
     * @param rows - The values to write.
     * @param values - What each row writes to the columns, in the order of the rows.
     * @param parameters - Collects what the branches bind.
     * @returns The branches, each choosing its row by the id.
     */
    private buildUpdateEachBranches(
        column: PostgresColumn,
        rows: DeepPartial<T>[],
        values: ColumnValues[],
        parameters: PostgresParameters
    ): string[] {
        const own: string = this.escape(column.name);
        const branches: string[] = [];
        for (const [r, row] of rows.entries()) {
            if (values[r]?.has(column.name) !== true) {
                continue;
            }
            const value: unknown = column.property == undefined ? undefined : Reflect.get(row, column.property);
            const metadata: PropertyMetadata | undefined = column.property == undefined
                ? undefined
                : this.properties[column.property];
            const merged: Newable<unknown> | undefined = metadata == undefined
                ? undefined
                : WriteDataUtilities.findMergedClass(value, metadata);
            // bound without a type: the column a case falls back to is what the database reads it as
            const written: string = merged != undefined && typeof value === 'object' && value != undefined
                ? this.buildObjectMergeSql(`${this.escape(ROW)}.${own}`, value, merged, parameters)
                : parameters.add(values[r]?.get(column.name));
            branches.push(`WHEN ${parameters.add(row.id)} THEN ${written}`);
        }
        return branches;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeMatching(
        where: Where<T> | undefined,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined
    ): Promise<string[]> {
        // the statement judges the filter on each row as it removes it, which is the whole of it
        const condition: ParameterizedSql = where == undefined
            ? { sql: 'TRUE', parameters: {} }
            : this.converter.convert(where, this.entityClass, ROW, related);
        const removed: Record<string, unknown>[] = await this.run({
            sql: `DELETE FROM ${this.escape(this.table.name)} AS ${this.escape(ROW)} WHERE ${condition.sql}`
                + ` RETURNING ${this.qualify(ROW, 'id')}`,
            parameters: condition.parameters
        }, transaction);
        return removed.map(row => String(row['id']));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async remove(ids: string[], reach: RemovalReach<T> | undefined, transaction: Transaction | undefined): Promise<string[]> {
        if (!ids.length) {
            return [];
        }
        const parameters: PostgresParameters = this.converter.createParameters();
        const listed: string = `${this.qualify(ROW, 'id')} = ANY(${parameters.addList(ids)})`;
        const condition: ParameterizedSql | undefined = reach == undefined
            ? undefined
            : this.converter.convert(reach.where, this.entityClass, ROW, reach.related);
        const conditions: string[] = [listed, ...condition == undefined ? [] : [condition.sql]];
        // wholly in the statement itself: a statement removes what matches as it runs, so a row gone or
        // out of reach by then would leave the others removed. Counting the rows still within reach as
        // part of it costs no round trip. A single row is all or nothing on its own
        if (reach?.wholly === true && ids.length > 1) {
            const within: ParameterizedSql = this.converter.convert(reach.where, this.entityClass, 'zi_within', reach.related);
            const withinIds: string = `${this.qualify('zi_within', 'id')} = ANY(${parameters.addList(ids)})`;
            conditions.push(
                `(SELECT COUNT(*) FROM ${this.escape(this.table.name)} "zi_within" WHERE ${withinIds} AND ${within.sql}) = ${ids.length}`
            );
            Object.assign(parameters.values, within.parameters);
        }
        // by id in one statement. Relations declaring a cascading remove are emitted as `ON DELETE
        // CASCADE` on the constraint, so what goes with a row is decided by the schema
        const removed: Record<string, unknown>[] = await this.run({
            sql: `DELETE FROM ${this.escape(this.table.name)} AS ${this.escape(ROW)} WHERE ${conditions.join(' AND ')}`
                + ` RETURNING ${this.qualify(ROW, 'id')}`,
            parameters: { ...parameters.values, ...condition?.parameters }
        }, transaction);
        return removed.map(row => String(row['id']));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        // in one order whatever order they were given in. A statement locks each row it conflicts with
        // as it reaches it, so two batches naming the same rows in opposite orders would each hold what
        // the other waits on. The caller still gets its own order back, since rows are paired by identity
        const identities: Map<UpsertRow<T>, string> = new Map(
            rows.map(row => [row, UpsertIdentityUtilities.resolveValues(identity, row.create)])
        );
        const ordered: UpsertRow<T>[] = [...rows].sort((a, b) => {
            const left: string = identities.get(a) ?? '';
            const right: string = identities.get(b) ?? '';
            return left < right ? -1 : left > right ? 1 : 0;
        });
        const statements: [UpsertRow<T>[], ParameterizedSql][] = this.resolveUpsertStatements(identity, ordered, reachable, related);
        const write: (on: Transaction | undefined) => Promise<Map<UpsertRow<T>, T>> = async on => {
            const res: Map<UpsertRow<T>, T> = await this.runUpserts(identity, statements, on);
            // a row that came back with nothing conflicted with a row it was not allowed to change - or
            // with one committed after the statement began, which a fresh statement sees. Nothing of
            // theirs was written by the first run, so running them again changes nothing twice
            const missing: UpsertRow<T>[] = ordered.filter(row => !res.has(row));
            if (missing.length && (reachable != undefined || missing.some(row => row.where != undefined))) {
                const retried: [UpsertRow<T>[], ParameterizedSql][] = this.resolveUpsertStatements(identity, missing, reachable, related);
                for (const [row, entity] of await this.runUpserts(identity, retried, on)) {
                    res.set(row, entity);
                }
            }
            return res;
        };
        // one statement is atomic on its own; several are held together the way one holds itself
        const written: Map<UpsertRow<T>, T> = transaction == undefined && statements.length > 1
            ? await this.inTransaction(undefined, write)
            : await write(transaction);
        return rows.map(row => {
            const res: T | undefined = written.get(row);
            if (res != undefined) {
                return res;
            }
            if (reachable != undefined || row.where != undefined) {
                // what inserting the identity would have answered, since to this caller the row holding
                // it is not there - or not one they may change
                const group: UniqueGroup = UpsertIdentityUtilities.resolveUniqueGroup(this.entityClass, identity);
                throw new UniqueConstraintViolationError(this.entityClass.name, group.properties);
            }
            throw new InternalError('upsert returned no row, which should not be reachable.');
        });
    }

    private async runUpserts(
        identity: string[],
        statements: [UpsertRow<T>[], ParameterizedSql][],
        transaction: Transaction | undefined
    ): Promise<Map<UpsertRow<T>, T>> {
        const res: Map<UpsertRow<T>, T> = new Map();
        // one after the other: several statements share the connection of one transaction, which runs a
        // single statement at a time anyway
        for (const [rows, statement] of statements) {
            const returned: T[] = this.schema.toEntities(this.entityClass, await this.run(statement, transaction));
            for (const [row, entity] of this.pairUpserted(identity, rows, returned)) {
                res.set(row, entity);
            }
        }
        return res;
    }

    /**
     * Splits the rows of an upsert into statements that each bind no more values than allowed - halved
     * rather than cut to a size worked out up front, because how many values a row binds differs per row.
     * @param identity - The properties identifying each row.
     * @param rows - The rows to write.
     * @param reachable - The rows the changes may be applied to.
     * @param related - What the rows the filters reach through a relation are narrowed to.
     * @returns The statements, each with the rows it writes.
     */
    private resolveUpsertStatements(
        identity: string[],
        rows: UpsertRow<T>[],
        reachable: Where<T> | undefined,
        related: RelatedNarrowing | undefined
    ): [UpsertRow<T>[], ParameterizedSql][] {
        const statement: ParameterizedSql = this.buildUpsertSql(identity, rows, reachable, related);
        if (Object.keys(statement.parameters).length <= this.maxBoundValuesPerStatement || rows.length === 1) {
            return [[rows, statement]];
        }
        const half: number = Math.ceil(rows.length / 2);
        return [
            ...this.resolveUpsertStatements(identity, rows.slice(0, half), reachable, related),
            ...this.resolveUpsertStatements(identity, rows.slice(half), reachable, related)
        ];
    }

    /**
     * Builds the statement inserting each row, or applying its changes to the row holding its identity.
     *
     * One assignment per column any row changes, choosing each row's change by the id that row was
     * proposed with - which is what EXCLUDED carries for the insert that conflicted. A conflicting row
     * the rows' conditions exclude is locked and left as it is, and the statement returns nothing for it.
     * @param identity - The properties identifying each row.
     * @param rows - The rows.
     * @param reachable - The rows the changes may be applied to.
     * @param related - What the rows the filters reach through a relation are narrowed to.
     * @returns The statement.
     * @throws When no row changes anything on a conflict.
     */
    private buildUpsertSql(
        identity: string[],
        rows: UpsertRow<T>[],
        reachable: Where<T> | undefined,
        related: RelatedNarrowing | undefined
    ): ParameterizedSql {
        const parameters: PostgresParameters = this.converter.createParameters();
        const table: string = this.escape(this.table.name);
        const id: string = this.escape('id');
        const values: ColumnValues[] = rows.map(row => this.resolveColumnValues(row.create));
        const columns: string[] = [...new Set(values.flatMap(v => [...v.keys()]))];
        const tuples: string = values
            .map(v => `(${columns.map(c => v.has(c) ? parameters.add(v.get(c)) : 'DEFAULT').join(', ')})`)
            .join(', ');

        const branches: Map<string, string[]> = new Map();
        for (const row of rows) {
            const when: string = `WHEN ${parameters.add(row.create.id)} THEN`;
            for (const [key, change] of ObjectUtilities.entries(row.onConflict)) {
                if (change == undefined) {
                    continue;
                }
                const column: PostgresColumn = this.schema.getColumn(this.entityClass, String(key));
                // an increment on its own branch, so postgres reads its parameter as the column's type
                // null counts as 0, as it does for an update's increments - added to as it is, it stayed null
                const then: string = 'increment' in change
                    ? `COALESCE(${table}.${this.escape(column.name)}, 0) + ${parameters.add(change.increment)}`
                    : parameters.add(column.toColumn(change.set));
                // added to rather than copied, which for a batch of many rows was the square of it
                const cases: string[] = branches.get(column.name) ?? [];
                cases.push(`${when} ${then}`);
                branches.set(column.name, cases);
            }
        }
        if (!branches.size) {
            throw new InternalError('upsert was called with an empty onConflict, so the conflict path would do nothing.');
        }
        // the stored value qualified with the table name, which is how postgres refers to the row that is
        // already there; unqualified would read the row being inserted instead
        const updates: string = [...branches]
            .map(([column, cases]) => {
                const own: string = this.escape(column);
                return `${own} = CASE EXCLUDED.${id} ${cases.join(' ')} ELSE ${table}.${own} END`;
            })
            .join(', ');

        // asked about the one row the conflict landed on rather than about every row the filter matches:
        // the filter is the caller's scope alone, which can match most of a table
        const reaches: (filter: Where<T>) => string = filter => {
            const condition: ParameterizedSql = this.converter.convert(filter, this.entityClass, 'zi_reachable', related);
            Object.assign(parameters.values, condition.parameters);
            return `EXISTS (SELECT 1 FROM ${table} "zi_reachable" WHERE "zi_reachable".${id} = ${table}.${id} AND ${condition.sql})`;
        };
        const filters: string[] = reachable == undefined ? [] : [reaches(reachable)];
        // a row's own condition is chosen by the id it was proposed with, the way its changes are
        const conditioned: string[] = rows.flatMap(row => row.where == undefined
            ? []
            : [`WHEN ${parameters.add(row.create.id)} THEN ${reaches(row.where)}`]);
        if (conditioned.length) {
            filters.push(`CASE EXCLUDED.${id} ${conditioned.join(' ')} ELSE TRUE END`);
        }
        return {
            sql: [
                `INSERT INTO ${table} (${columns.map(c => this.escape(c)).join(', ')}) VALUES ${tuples}`,
                `ON CONFLICT ${this.resolveConflictTarget(identity)}`,
                `DO UPDATE SET ${updates}`,
                ...filters.length ? [`WHERE ${filters.join(' AND ')}`] : [],
                'RETURNING *'
            ].join(' '),
            parameters: parameters.values
        };
    }

    /**
     * What an upsert on the given identity conflicts against: a key covering every row is a constraint
     * and is named, one covering some of them is an index, described by its columns and the condition
     * it was created with - built from the declaration the schema was built from, so neither drifts.
     * @param identity - The properties the caller identified the row by.
     * @returns The conflict target, as sql.
     */
    private resolveConflictTarget(identity: string[]): string {
        const declared: UniqueGroup = UpsertIdentityUtilities.resolveUniqueGroup(this.entityClass, identity);
        if (declared.where == undefined || coversEveryRow(declared.where)) {
            return `ON CONSTRAINT ${this.escape(uniqueConstraintName(this.table.name, declared.properties))}`;
        }
        const columns: string = declared.properties.map(p => this.escape(this.schema.getColumn(this.entityClass, p).name)).join(', ');
        return `(${columns}) WHERE ${keyWhereToSql(this.entityClass, declared.where)}`;
    }

    /**
     * Pairs the rows an upsert statement returned with the rows it was given, by the identity both
     * hold - a statement promises no order, and leaves out a row it was not allowed to change.
     * @param identity - The properties identifying each row.
     * @param rows - The rows the statement was given.
     * @param returned - The rows it returned.
     * @returns The row written for each row given. A row missing from it was not written.
     * @throws When a returned row pairs with none of the rows given.
     */
    private pairUpserted(identity: string[], rows: UpsertRow<T>[], returned: T[]): Map<UpsertRow<T>, T> {
        const [onlyRow] = rows;
        const [onlyReturned] = returned;
        if (rows.length === 1 && returned.length === 1 && onlyRow != undefined && onlyReturned != undefined) {
            return new Map([[onlyRow, onlyReturned]]);
        }
        const byIdentity: Map<string, T> = new Map(
            returned.map(r => [UpsertIdentityUtilities.resolveValues(identity, r), r])
        );
        const res: Map<UpsertRow<T>, T> = new Map();
        for (const row of rows) {
            const written: T | undefined = byIdentity.get(UpsertIdentityUtilities.resolveValues(identity, row.create));
            if (written != undefined) {
                res.set(row, written);
            }
        }
        // a returned row that pairs with nothing cannot be told apart from one that was refused, and
        // running its row again would apply its change twice
        if (res.size !== returned.length) {
            throw new InternalError(
                'upsert returned a row whose identity matches none of the rows it was given, so the rows cannot be paired.'
            );
        }
        return res;
    }

    /**
     * Resolves what an update sets each column to: the value given, for an object the stored one with
     * the given one merged in, and for an amount what is stored plus the amount.
     * @param data - The change.
     * @param increments - The amounts to add, by property.
     * @param parameters - Collects what the assignments bind.
     * @returns The assignments.
     */
    private resolveUpdateSet(
        data: DeepPartial<T>,
        increments: Record<string, number> | undefined,
        parameters: PostgresParameters
    ): string[] {
        const set: string[] = [];
        const values: ColumnValues = this.resolveColumnValues(data);
        for (const [name, value] of values) {
            const column: PostgresColumn | undefined = this.table.columns.find(c => c.name === name);
            const given: unknown = column?.property == undefined ? undefined : Reflect.get(data, column.property);
            const metadata: PropertyMetadata | undefined = column?.property == undefined
                ? undefined
                : this.properties[column.property];
            const merged: Newable<unknown> | undefined = metadata == undefined
                ? undefined
                : WriteDataUtilities.findMergedClass(given, metadata);
            const own: string = this.escape(name);
            const stored: string = `${this.escape(ROW)}.${own}`;
            set.push(merged != undefined && typeof given === 'object' && given != undefined
                ? `${own} = ${this.buildObjectMergeSql(stored, given, merged, parameters)}`
                : `${own} = ${parameters.add(value)}`);
        }
        for (const [key, amount] of Object.entries(increments ?? {})) {
            const column: string = this.escape(this.schema.getColumn(this.entityClass, key).name);
            // a column holding no value counts as 0, as it does on every other store
            set.push(`${column} = COALESCE(${this.escape(ROW)}.${column}, 0) + ${parameters.add(amount)}`);
        }
        return set;
    }

    /**
     * Builds the expression an update sets an object column to: the object it holds, with the given one
     * merged in as {@link WriteDataUtilities.resolveMerged} merges it.
     *
     * `||` writes the keys of the right over the left, one level deep. So the values written as given go
     * in as one object, and an object inside is merged the same way into what the stored one holds under
     * its key, which makes the merge as deep as the objects go.
     * @param target - The expression reading the stored object.
     * @param value - The object the update gives.
     * @param cls - Its declared class.
     * @param parameters - Collects what the expression binds.
     * @returns The expression.
     */
    private buildObjectMergeSql(target: string, value: object, cls: Newable<unknown>, parameters: PostgresParameters): string {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(cls);
        const given: Record<string, unknown> = {};
        const nested: string[] = [];
        const entries: [string, unknown][] = Object.entries(value);
        for (const [key, v] of entries) {
            const metadata: PropertyMetadata | undefined = properties[key];
            const merged: Newable<unknown> | undefined = metadata == undefined
                ? undefined
                : WriteDataUtilities.findMergedClass(v, metadata);
            if (merged == undefined || typeof v !== 'object' || v == undefined) {
                given[key] = v;
                continue;
            }
            const name: string = `CAST(${parameters.add(key)} AS text)`;
            const stored: string = `${target} -> ${name}`;
            nested.push(`${name}, ${this.buildObjectMergeSql(stored, v, merged, parameters)}`);
        }
        // a row holding no object, or null, has nothing to merge into, and is given the object as it is
        const own: string = `(CASE WHEN jsonb_typeof(${target}) = 'object' THEN ${target} ELSE CAST('{}' AS jsonb) END)`
            + ` || CAST(${parameters.add(JsonUtilities.stringify(toJsonValue(given)))} AS jsonb)`;
        return nested.length ? `(${own} || jsonb_build_object(${nested.join(', ')}))` : `(${own})`;
    }

    // ── relations written with a row ────────────────────────────

    /**
     * Resolves what a row writes to the columns of its own table: the values of its own properties, and
     * the key of a related row it gives a relation to one row as.
     * @param row - The row.
     * @returns The values, by column, each as the column is handed it.
     */
    private resolveColumnValues(row: object): ColumnValues {
        const res: ColumnValues = new Map();
        for (const column of this.table.columns) {
            if (column.property == undefined) {
                continue;
            }
            const value: unknown = Reflect.get(row, column.property);
            if (value !== undefined) {
                res.set(column.name, column.toColumn(value));
            }
        }
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            const value: unknown = Reflect.get(row, key);
            if (
                value === undefined
                || !this.writesRelation(metadata)
                || (metadata.type !== Relation.MANY_TO_ONE && metadata.type !== Relation.BELONGS_TO_ONE)
            ) {
                continue;
            }
            if (value === null) {
                // eslint-disable-next-line unicorn/no-null
                res.set(metadata.joinColumn, null);
            }
            else if (typeof value === 'object' && 'id' in value && value.id != undefined) {
                res.set(metadata.joinColumn, value.id);
            }
        }
        return res;
    }

    /**
     * Whether a write gives a relation a value that it stores: a relation keeping its persistence.
     * @param metadata - The property.
     * @returns True for a relation whose value the write stores.
     */
    private writesRelation(metadata: PropertyMetadata): metadata is RelationMetadata<BaseEntity> & PropertyMetadata {
        if (!isRelationMetadata(metadata)) {
            return false;
        }
        if (metadata.type === Relation.MANY_TO_MANY) {
            return metadata.persistence;
        }
        // a key is written from a relation that cascades inserts on either side, as typeorm wrote it
        const inverse: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(metadata.target())[String(metadata.inverseSide)];
        const inserts: (cascade: RelationMetadata<BaseEntity>['cascade']) => boolean = cascade => cascade === true
            || (Array.isArray(cascade) && cascade.includes('insert'));
        return inserts(metadata.cascade) || (isRelationMetadata(inverse) && inserts(inverse.cascade));
    }

    private writesJunctionRows(rows: object[]): boolean {
        return ObjectUtilities.entries(this.properties).some(([key, metadata]) => metadata.type === Relation.MANY_TO_MANY
            && this.writesRelation(metadata)
            && rows.some(row => Array.isArray(Reflect.get(row, key))));
    }

    /**
     * Writes the rows of the join tables of the many to many relations the rows give a list for.
     * @param rows - The rows, each with its id.
     * @param transaction - The transaction to write in.
     * @param replace - Whether the list replaces the rows the join table holds for the row, rather than
     * being the first ones.
     */
    private async writeJunctionRows(rows: DeepPartial<T>[], transaction: Transaction | undefined, replace: boolean): Promise<void> {
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (metadata.type !== Relation.MANY_TO_MANY || !this.writesRelation(metadata)) {
                continue;
            }
            const join: PostgresRelationJoin = this.schema.getJoin(this.entityClass, key);
            const given: [string, string[]][] = rows.flatMap((row): [string, string[]][] => {
                const list: unknown = Reflect.get(row, key);
                if (!Array.isArray(list)) {
                    return [];
                }
                const ids: string[] = list.flatMap((item: unknown) => typeof item === 'object' && item != undefined && 'id' in item
                    ? [String(item.id)]
                    : []);
                return [[String(row.id), ids]];
            });
            if (join.kind !== 'junction' || !given.length) {
                continue;
            }
            const junction: string = this.escape(join.junction);
            const own: string = this.escape(join.ownColumn);
            const target: string = this.escape(join.targetColumn);
            if (replace) {
                // the rows of the join table the list no longer names
                const parameters: PostgresParameters = this.converter.createParameters();
                const dropped: string = given
                    .map(([id, targets]) => `(${own} = ${parameters.add(id)} AND ${target} <> ALL(${parameters.addList(targets)}))`)
                    .join(' OR ');
                await this.run({ sql: `DELETE FROM ${junction} WHERE ${dropped}`, parameters: parameters.values }, transaction);
            }
            const pairs: [string, string][] = given.flatMap(([id, targets]) => targets.map((t): [string, string] => [id, t]));
            if (!pairs.length) {
                continue;
            }
            const parameters: PostgresParameters = this.converter.createParameters();
            const tuples: string = pairs.map(([id, t]) => `(${parameters.add(id)}, ${parameters.add(t)})`).join(', ');
            // a pair the join table holds already is the relation as it was, which is no conflict
            await this.run({
                sql: `INSERT INTO ${junction} (${own}, ${target}) VALUES ${tuples} ON CONFLICT DO NOTHING`,
                parameters: parameters.values
            }, transaction);
        }
    }

    /**
     * Hands back the relations a row gave as they were given, on the entity written: a write hands back
     * what it wrote, and the rows beside it are no more part of it than they were before.
     * @param entity - The entity, as stored.
     * @param row - The row as it was given.
     * @returns The entity.
     */
    private withGivenRelations(entity: T, row: object): T {
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            const value: unknown = Reflect.get(row, key);
            if (isRelationMetadata(metadata) && value !== undefined) {
                Reflect.set(entity, key, value);
            }
        }
        return entity;
    }

    // ── helpers ─────────────────────────────────────────────────

    private resolveRowsPerStatement(valuesPerRow: number): number {
        return Math.max(1, Math.floor(this.maxBoundValuesPerStatement / Math.max(1, valuesPerRow)));
    }

    private byIds(ids: (string | T['id'])[]): Where<T> {
        return { id: { oneOf: ids } } as Where<T>;
    }

    private qualify(alias: string, property: string): string {
        return PostgresSqlUtilities.qualify(alias, this.schema.getColumn(this.entityClass, property).name);
    }

    private escape(name: string): string {
        return PostgresSqlUtilities.escapeIdentifier(name);
    }

    private async inTransaction<R>(transaction: Transaction | undefined, fn: (transaction: Transaction) => Promise<R>): Promise<R> {
        if (transaction) {
            return await fn(transaction);
        }
        const own: Transaction = await this.dataSource.startTransaction();
        try {
            const res: R = await fn(own);
            await own.commit();
            return res;
        }
        catch (error) {
            await own.rollback();
            throw error;
        }
    }

    private async run(statement: ParameterizedSql, transaction: Transaction | undefined): Promise<Record<string, unknown>[]> {
        return await this.dataSource.runStatement(statement, transaction, this.entityClass);
    }
}