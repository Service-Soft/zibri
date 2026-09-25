import { AtomicUpdate, BaseEntity, coversEveryRow, DeepPartial, DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, EntityMetadata, EntityMetadataMissingError, EntityOrderUtilities, EntityRelationsUtilities, InternalError, JsonUtilities, MetadataUtilities, ModelRegistry, Newable, ObjectUtilities, OrderKey, PaginationResult, parseArray, parseObject, parseOneOf, PropertyMetadata, Relation, RelationMetadata, RelationTree, RelationTreeByRowId, RepositoryDriverInterface, Transaction, UniqueConstraintViolationError, UniqueGroup, upsertConflictWhere, UUIDUtilities, Where, WhereFilterEvaluator } from 'zibri';

import { InMemoryScope, InMemoryStore, StoredRow } from './in-memory-store';
import { InMemoryTransaction } from './in-memory-transaction.model';

/**
 * How many rows a stream loads at once.
 *
 * Matches what the real drivers use, so a test that streams here walks the same number of batches it
 * would against postgres - which is what makes a batch boundary bug reproducible in a test.
 */
const STREAM_BATCH_SIZE: number = 500;

/**
 * One property change of an upsert, as the driver reads it back off an `AtomicUpdate`.
 *
 * `AtomicUpdate` offers `increment` only on numeric properties, which is the right contract for a
 * caller naming one property at a time. A driver walks every property at once and cannot carry that
 * per property type, so the union is widened here - once, rather than at each use.
 */
type UpsertChange = { /** Adds the given amount to the stored value. */ increment: number }
    | { /** Overwrites the stored value. */ set: unknown };

/**
 * The repository driver that reads and writes entities from and to an {@link InMemoryStore}.
 *
 * ## Layout
 * Every entity is a row in a map keyed by its table name, holding one json encoded value per column.
 * Many to many relations are kept as a set of related ids per side, under a key built from the table,
 * the row id and the property.
 *
 * ## Atomicity
 * Every method here is synchronous inside, and the `async` on the public ones is only there because
 * the interface asks for a promise. That is what makes a read followed by a write atomic without
 * anything being locked: with no `await` between them the runtime has nothing it may interleave.
 * The shipped drivers take a grant per key instead, because for them another process really can
 * write in between - see `RepositoryDriverInterface.upsert`.
 *
 * ## Differences to the shipped drivers
 * - **Unique declarations are checked by scanning, not by an index.** A test holds few enough rows
 * for the scan to cost nothing, and it removes an index that could disagree with the rows it
 * describes. It also closes the gap the valkey driver documents, where a row written before its
 * index existed carries no entry: there is nothing here that can be out of date.
 * - **Filters are never pushed down.** Every row of the table is loaded and then filtered by the
 * {@link WhereFilterEvaluator}, with none of the shortcuts the valkey driver uses to avoid reading
 * everything. Same answers, and one code path rather than three.
 */
export class InMemoryRepositoryDriver<T extends BaseEntity> implements RepositoryDriverInterface<T> {

    private readonly evaluator: WhereFilterEvaluator = new WhereFilterEvaluator();

    private readonly properties: Record<string, PropertyMetadata>;

    private readonly tableName: string;

    /**
     * Every set of properties that names at most one row, each in a stable order.
     *
     * Both ways of declaring it end up here, so neither has to be repeated: a property carrying
     * `unique` is a group of one, and a group in the entity's `uniques` is the multi property form.
     */
    private readonly uniqueGroups: UniqueGroup[];

    constructor(
        private readonly entityClass: Newable<T>,
        private readonly store: InMemoryStore
    ) {
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
        if (!metadata) {
            throw new EntityMetadataMissingError(entityClass);
        }
        this.tableName = metadata.tableName;
        this.properties = MetadataUtilities.getModelProperties(entityClass);
        this.uniqueGroups = this.resolveUniqueGroups();
    }

    /**
     * Resolves what to read and write through.
     * @param transaction - The transaction the caller provided, if any.
     * @returns The transaction when there is one, the store itself otherwise.
     * @throws When the transaction was started by a different kind of data source.
     */
    private scope(transaction: Transaction | undefined): InMemoryScope {
        if (transaction == undefined) {
            return this.store;
        }
        if (!(transaction instanceof InMemoryTransaction)) {
            throw new InternalError('The provided transaction does not belong to an in memory data source.');
        }
        return transaction;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        return this.persist(data, this.scope(transaction), reload);
    }

    /**
     * Writes the given rows and their relations.
     * @param data - The rows to write. Entries without an id are inserted, entries with one are updated.
     * @param scope - What to write through.
     * @param reload - Whether or not the written rows should be read back.
     * @returns The written rows when they were reloaded, an empty array otherwise.
     */
    private persist(data: DeepPartial<T>[], scope: InMemoryScope, reload: boolean): T[] {
        const ids: string[] = [];
        const relationsById: Map<string, RelationTree> = new Map();
        const childrenById: Map<string, Map<string, BaseEntity[]>> = new Map();

        for (const entry of data) {
            const id: string = entry.id ?? this.generateId(scope);
            const existing: StoredRow | undefined = scope.readRow(this.tableName, id);
            const fields: StoredRow = this.toFields(entry, existing == undefined);

            // an update carries only some properties, so what the row ends up holding is the stored
            // row with the write applied over it
            const row: StoredRow = { ...existing, ...fields, id: JSON.stringify(id) };

            // before the write rather than after it, so a refused save leaves nothing behind even
            // when the caller passed no transaction to roll back
            this.assertUniquesFree(row, id, scope);

            scope.writeRow(this.tableName, id, row);
            childrenById.set(id, this.saveToManyRelations(id, entry, scope, reload));
            this.saveManyToManyRelations(id, entry, scope);
            ids.push(id);
            relationsById.set(id, this.providedKeyRelations(entry));
        }

        if (!reload) {
            return [];
        }
        // with the relations each row's data wrote, as they were stored, so a caller gets the ids of
        // the rows created along with it - the rows of a to many relation being the ones just written
        const res: T[] = this.loadRows(ids, {}, scope, relationsById);
        for (const entity of res) {
            for (const [key, children] of childrenById.get(entity.id) ?? []) {
                (entity as Record<string, unknown>)[key] = this.properties[key]?.type === Relation.HAS_ONE ? children.at(0) : children;
            }
        }
        return res;
    }

    /**
     * The relations the given data provides a value for that are read back by the ids they hold: a
     * many to many relation, and a to one relation given as an entity.
     * @param data - The data being saved.
     * @returns Their keys, each with nothing below it: a write hands back the rows it wrote, and the
     * rows beside those are no more part of it than the rows beside the entity are.
     */
    private providedKeyRelations(data: DeepPartial<T>): RelationTree {
        const res: Map<string, RelationTree> = new Map();
        for (const key of ObjectUtilities.keys(this.properties)) {
            const type: string | undefined = this.properties[key]?.type;
            const provided: boolean = (type === Relation.MANY_TO_MANY || type === Relation.MANY_TO_ONE || type === Relation.BELONGS_TO_ONE)
                && (data as Record<string, unknown>)[key] != undefined;
            if (provided) {
                res.set(key, new Map());
            }
        }
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async find(options: DriverFindOptions<T>): Promise<T[]> {
        return this.findRows(options, this.scope(options.transaction));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        const counted: T[] = this.findRows(
            { ...options, where: options.totalWhere ?? options.where, skip: undefined, take: undefined },
            this.scope(options.transaction)
        );
        // the window is a narrowing of what was just counted, so it is taken out of that rather than
        // read again - which is what keeps the two halves describing the same moment
        const matching: T[] = options.totalWhere == undefined || options.where == undefined
            ? counted
            : counted.filter(e => this.evaluator.matches(e, options.where as Where<T>, this.entityClass));

        const skip: number = options.skip ?? 0;
        return {
            items: options.take == undefined ? matching.slice(skip) : matching.slice(skip, skip + options.take),
            totalAmount: counted.length
        };
    }

    /**
     * Loads every row of the table, filters it and applies the order and window.
     * @param options - The resolved find options.
     * @param scope - What to read through.
     * @returns The matching entities.
     */
    private findRows(options: DriverFindOptions<T>, scope: InMemoryScope): T[] {
        const entities: T[] = this.loadRows(scope.ids(this.tableName), options, scope);

        const filtered: T[] = options.where
            ? entities.filter(e => this.evaluator.matches(e, options.where as Where<T>, this.entityClass))
            : entities;
        const ordered: T[] = this.applyOrder(filtered, options.order);

        const skip: number = options.skip ?? 0;
        const window: T[] = options.take == undefined ? ordered.slice(skip) : ordered.slice(skip, skip + options.take);
        // after the window rather than before it, so that nothing is taken off a row that is about to
        // be thrown away
        EntityRelationsUtilities.keepOnlyRequested(
            window,
            this.relationsToResolve(options),
            EntityRelationsUtilities.resolveTree(options.relations)
        );
        return window;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        return this.findRows({ ...options, skip: undefined, take: 1 }, this.scope(options.transaction)).at(0);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async* stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        const scope: InMemoryScope = this.scope(options.transaction);
        const ids: string[] = scope.ids(this.tableName);

        for (let i: number = 0; i < ids.length; i += STREAM_BATCH_SIZE) {
            const entities: T[] = this.loadRows(ids.slice(i, i + STREAM_BATCH_SIZE), options, scope);
            for (const entity of entities) {
                if (options.where && !this.evaluator.matches(entity, options.where, this.entityClass)) {
                    continue;
                }
                yield entity;
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async count(options: DriverFindOptions<T>): Promise<number> {
        const scope: InMemoryScope = this.scope(options.transaction);
        if (!options.where) {
            return scope.ids(this.tableName).length;
        }
        return this.findRows({ where: options.where }, scope).length;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async remove(entities: T[], transaction: Transaction | undefined): Promise<T[]> {
        const scope: InMemoryScope = this.scope(transaction);

        for (const entity of entities) {
            this.removeManyToManyRelations(entity.id, scope);
            scope.deleteRow(this.tableName, entity.id);
        }
        return entities;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async updateAll<R extends boolean = false>(
        options: DriverUpdateAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        const { where, data, transaction, returnUpdated }: DriverUpdateAllOptions<T, R> = options;
        const scope: InMemoryScope = this.scope(transaction);

        // no grant per row, and no second read once they are held, unlike the valkey driver. Both
        // exist there to close the window between reading which rows match and writing them, and
        // there is no such window here: nothing is awaited between the two.
        const matched: T[] = this.findRows({ where }, scope);
        if (!matched.length) {
            return (returnUpdated === true ? [] : 0) as R extends true ? T[] : number;
        }

        // the write is what knows which rows it wrote, so it is what hands them back. Reading them
        // again would also have to read them by id rather than by re-running the filter: the update
        // may well have changed a column the filter matches on - updateAll({ status: 'QUEUED' },
        // { status: 'SENT' }) being the obvious case - and re-running it then returns the rows that
        // were *not* touched
        const updated: T[] = this.persist(
            matched.map(m => ({ ...data, id: m.id })),
            scope,
            returnUpdated === true
        );
        return (returnUpdated === true ? updated : matched.length) as R extends true ? T[] : number;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc, typescript/require-await
    async upsert(
        identity: DeepPartial<T>,
        create: DeepPartial<T>,
        onConflict: AtomicUpdate<T>,
        transaction: Transaction | undefined
    ): Promise<T> {
        const changes: [string, UpsertChange][] = ObjectUtilities
            .entries(onConflict as Record<string, UpsertChange | undefined>)
            .filter((entry): entry is [string, UpsertChange] => entry[1] != undefined);

        if (!changes.length) {
            throw new InternalError('upsert was called with an empty onConflict, so the conflict path would do nothing.');
        }
        // the identity has to name at most one row, exactly as it does on a shipped driver, and the
        // rows it may land on are the ones the key covers rather than every row holding the value
        const conflictWhere: Where<T> = upsertConflictWhere(this.entityClass, identity);

        const scope: InMemoryScope = this.scope(transaction);
        const found: T | undefined = this.findRows({ where: conflictWhere }, scope).at(0);

        if (found == undefined) {
            return this.onlyPersisted(this.persist([create], scope, true));
        }

        const updated: Record<string, unknown> = { id: found.id };
        for (const [key, change] of changes) {
            updated[key] = 'increment' in change
                ? Number((found as Record<string, unknown>)[key]) + change.increment
                : change.set;
        }
        return this.onlyPersisted(this.persist([updated as DeepPartial<T>], scope, true));
    }

    /**
     * Refuses the write when another row already holds the values a unique declaration names.
     *
     * A scan rather than an index, which is what a store this size can afford: the answer is read
     * off the rows themselves, so there is nothing that could describe them wrongly.
     * @param row - The row about to be written, as it will be stored.
     * @param id - The id it will be written under.
     * @param scope - What to read through, so rows written earlier in this transaction are seen.
     * @throws When another row already holds the values one of the declarations names.
     */
    private assertUniquesFree(row: StoredRow, id: string, scope: InMemoryScope): void {
        for (const group of this.uniqueGroups) {
            const values: string | undefined = this.uniqueValuesOf(group.properties, row);
            // a row the declaration leaves out holds nothing as far as it is concerned, so it
            // neither takes a value nor collides with one
            if (values == undefined || !this.coveredBy(group, row)) {
                continue;
            }
            for (const otherId of scope.ids(this.tableName)) {
                // a row is never a duplicate of itself
                if (otherId === id) {
                    continue;
                }
                const other: StoredRow | undefined = scope.readRow(this.tableName, otherId);
                if (
                    other != undefined
                    && this.coveredBy(group, other)
                    && this.uniqueValuesOf(group.properties, other) === values
                ) {
                    throw new UniqueConstraintViolationError(this.entityClass.name, group.properties);
                }
            }
        }
    }

    /**
     * Whether a row belongs to the rows a unique declaration covers.
     * @param group - The declaration.
     * @param row - The row as it is stored.
     * @returns True when the declaration applies to this row.
     */
    private coveredBy(group: UniqueGroup, row: StoredRow): boolean {
        if (group.where == undefined || coversEveryRow(group.where)) {
            return true;
        }
        return this.evaluator.matches(this.fromFields(row), group.where as Where<T>, this.entityClass);
    }

    /**
     * Collects every set of properties that names at most one row.
     *
     * Sorted and de-duplicated here rather than taken as declared, so two declarations naming the
     * same columns in a different order are treated as the one declaration they are.
     * @returns The groups, each in a stable order, without duplicates.
     */
    private resolveUniqueGroups(): UniqueGroup[] {
        // merged by the registry, so that what counts as unique is decided in one place for every
        // store rather than once here and once wherever else it is asked
        const groups: UniqueGroup[] = ModelRegistry.get(this.entityClass).keyDescriptor.uniques;
        const seen: Set<string> = new Set();
        return groups
            .map(g => ({ properties: [...g.properties].sort(), where: g.where }))
            .filter(g => {
                // the rows a group covers are part of what makes it that group
                const id: string = `${g.properties.join(',')}|${g.where == undefined ? '' : JsonUtilities.stringify(g.where)}`;
                if (seen.has(id)) {
                    return false;
                }
                seen.add(id);
                return true;
            });
    }

    /**
     * Reads the values a group names off a stored row.
     * @param group - The properties of the unique declaration.
     * @param row - The row, as the json encoded fields it is stored as.
     * @returns The values as one string, or undefined when the row does not carry all of them - a
     * row missing part of a group is not named by it and therefore cannot collide on it.
     */
    private uniqueValuesOf(group: string[], row: StoredRow): string | undefined {
        const values: string[] = [];
        for (const key of group) {
            if (row[key] == undefined) {
                return undefined;
            }
            values.push(`${key}=${row[key]}`);
        }
        return values.join(':');
    }

    /**
     * Loads the rows with the given ids and resolves their relations when they are needed.
     * @param ids - The ids to load.
     * @param options - The find options, used to determine which relations need to be resolved.
     * @param scope - What to read through.
     * @param relationsById - The relations to resolve on a row in place of the ones the options name,
     * by the id of the row.
     * @returns The loaded entities, skipping ids the table no longer holds.
     */
    private loadRows(
        ids: string[],
        options: DriverFindOptions<T>,
        scope: InMemoryScope,
        relationsById?: RelationTreeByRowId
    ): T[] {
        const requested: RelationTree = this.relationsToResolve(options);
        const res: T[] = [];

        for (const id of ids) {
            const row: StoredRow | undefined = scope.readRow(this.tableName, id);
            if (row == undefined) {
                continue;
            }
            const entity: T = this.fromFields(row);
            this.resolveRelations(entity, relationsById?.get(id) ?? requested, scope);
            res.push(entity);
        }
        return res;
    }

    /**
     * Determines which relations need to be resolved for the given options.
     *
     * Only the ones that were explicitly requested and the ones the filter or the order cannot be
     * answered without, so a find that mentions no relation does not walk the graph. The last two
     * are taken off the rows again once the read is done, since neither is a caller asking for one.
     * @param options - The find options.
     * @returns The relations to resolve, and the relations to resolve below each of those.
     */
    private relationsToResolve(options: DriverFindOptions<T>): RelationTree {
        const forFilter: Map<string, RelationTree> = new Map();
        for (const filter of Array.isArray(options.where) ? options.where : [options.where]) {
            for (const key of ObjectUtilities.keys((filter ?? {}) as Record<string, unknown>)) {
                if (this.isRelation(this.properties[key])) {
                    forFilter.set(key, new Map());
                }
            }
        }
        return EntityRelationsUtilities.mergeTrees(
            EntityRelationsUtilities.mergeTrees(
                EntityRelationsUtilities.resolveTree(options.relations),
                EntityOrderUtilities.resolveRelations(options.order)
            ),
            forFilter
        );
    }

    /**
     * Fills in the given relations on an entity that has just been read.
     * @param entity - The entity to resolve them on.
     * @param relations - The property keys to resolve.
     * @param scope - What to read through.
     */
    private resolveRelations(entity: T, relations: RelationTree, scope: InMemoryScope): void {
        for (const [key, below] of relations) {
            const metadata: PropertyMetadata | undefined = this.properties[key];
            if (metadata == undefined || !this.isRelation(metadata)) {
                continue;
            }
            (entity as Record<string, unknown>)[key] = this.resolveRelation(entity, key, metadata, below, scope);
        }
    }

    /**
     * Reads the other side of one relation.
     *
     * The related entities are loaded with the relations named below this one and no others, so a
     * circular declaration stops where the request does rather than recursing forever.
     * @param entity - The entity the relation is being resolved on.
     * @param key - The property key of the relation.
     * @param metadata - The metadata of the relation.
     * @param below - The relations to resolve on the entities this one reads.
     * @param scope - What to read through.
     * @returns The related entity, the related entities, or undefined.
     */
    private resolveRelation(
        entity: T,
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        below: RelationTree,
        scope: InMemoryScope
    ): unknown {
        const targetClass: Newable<BaseEntity> = metadata.target();
        const targetDriver: InMemoryRepositoryDriver<BaseEntity> = new InMemoryRepositoryDriver(targetClass, this.store);

        switch (metadata.type) {
            case Relation.MANY_TO_ONE:
            case Relation.BELONGS_TO_ONE: {
                const foreignKey: unknown = (entity as Record<string, unknown>)[this.resolveJoinColumn(metadata, key)];
                if (foreignKey == undefined) {
                    return undefined;
                }
                // eslint-disable-next-line typescript/no-base-to-string
                return targetDriver.loadRows([String(foreignKey)], { relations: below }, scope).at(0);
            }
            case Relation.ONE_TO_MANY:
            case Relation.HAS_ONE: {
                const foreignKeyColumn: string = this.requireInverseJoinColumn(metadata, key);
                const targets: BaseEntity[] = targetDriver.findRows(
                    { where: { [foreignKeyColumn]: entity.id } as never, relations: below },
                    scope
                );
                return metadata.type === Relation.HAS_ONE ? targets.at(0) : targets;
            }
            case Relation.MANY_TO_MANY: {
                const ids: string[] = [...scope.readJoin(this.joinKey(entity.id, key))];
                return targetDriver.loadRows(ids, { relations: below }, scope);
            }
        }
    }

    /**
     * Persists the entities of a one to many or has one relation that were provided with the data.
     *
     * Just like a shipped data source, this only happens when the relation (or its inverse side) has
     * the cascade insert flag set, otherwise the provided entities are ignored.
     * @param id - The id of the entity that was saved.
     * @param data - The data that was saved.
     * @param scope - What to write through.
     * @param reload - Whether the written entities should be read back.
     * @returns The written entities of each relation by its key, when they were read back.
     */
    private saveToManyRelations(id: string, data: DeepPartial<T>, scope: InMemoryScope, reload: boolean): Map<string, BaseEntity[]> {
        const res: Map<string, BaseEntity[]> = new Map();
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (metadata.type !== Relation.ONE_TO_MANY && metadata.type !== Relation.HAS_ONE) {
                continue;
            }
            const value: unknown = (data as Record<string, unknown>)[key];
            if (value == undefined || !this.hasCascadeInsert(metadata)) {
                continue;
            }

            const foreignKeyColumn: string = this.requireInverseJoinColumn(metadata, key);
            const children: unknown[] = Array.isArray(value) ? value : [value];
            const targetDriver: InMemoryRepositoryDriver<BaseEntity> = new InMemoryRepositoryDriver(metadata.target(), this.store);

            const saved: BaseEntity[] = targetDriver.persist(
                children.map(c => ({ ...c as DeepPartial<BaseEntity>, [foreignKeyColumn]: id })),
                scope,
                reload
            );
            if (reload) {
                res.set(key, saved);
            }
        }
        return res;
    }

    /**
     * Updates both sides of every many to many relation the saved data provided.
     * @param id - The id of the entity that was saved.
     * @param data - The data that was saved.
     * @param scope - What to write through.
     * @throws When the provided value is not an array.
     */
    private saveManyToManyRelations(id: string, data: DeepPartial<T>, scope: InMemoryScope): void {
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (metadata.type !== Relation.MANY_TO_MANY) {
                continue;
            }
            const value: unknown = (data as Record<string, unknown>)[key];
            if (value == undefined) {
                continue;
            }
            if (!Array.isArray(value)) {
                throw new InternalError(`The many to many relation "${this.entityClass.name}.${key}" needs to be an array.`);
            }

            const joinKey: string = this.joinKey(id, key);
            const current: Set<string> = scope.readJoin(joinKey);
            const next: Set<string> = new Set(this.resolveRelatedIds(metadata, value, scope));
            scope.writeJoin(joinKey, next);

            // both sides keep their own set, so the inverse side has to be updated too - and only
            // for the members that actually changed, so a save that leaves the relation as it was
            // writes nothing
            this.applyToInverseJoin([...current].filter(c => !next.has(c)), metadata, id, scope, 'remove');
            this.applyToInverseJoin([...next].filter(n => !current.has(n)), metadata, id, scope, 'add');
        }
    }

    /**
     * Adds or removes this row on the inverse side of a many to many relation.
     * @param relatedIds - The rows on the other side whose set changes.
     * @param metadata - The metadata of the relation on this side.
     * @param id - The id of the row being saved.
     * @param scope - What to write through.
     * @param change - Whether this row joins those sets or leaves them.
     */
    private applyToInverseJoin(
        relatedIds: string[],
        metadata: RelationMetadata<BaseEntity>,
        id: string,
        scope: InMemoryScope,
        change: 'add' | 'remove'
    ): void {
        const inverseDriver: InMemoryRepositoryDriver<BaseEntity> = new InMemoryRepositoryDriver(metadata.target(), this.store);

        for (const relatedId of relatedIds) {
            const inverseKey: string = inverseDriver.joinKey(relatedId, metadata.inverseSide);
            const members: Set<string> = scope.readJoin(inverseKey);
            if (change === 'add') {
                members.add(id);
            }
            else {
                members.delete(id);
            }
            scope.writeJoin(inverseKey, members);
        }
    }

    /**
     * Resolves the ids of the members of a many to many relation.
     *
     * Members that do not have an id yet are inserted first, but only when the relation has the
     * cascade insert flag set. Without it they cannot be referenced and are rejected.
     * @param metadata - The metadata of the relation.
     * @param members - The members that were provided with the saved data.
     * @param scope - What to write through.
     * @returns The ids of the members.
     * @throws When a member has no id and the relation does not cascade inserts.
     */
    private resolveRelatedIds(metadata: RelationMetadata<BaseEntity>, members: unknown[], scope: InMemoryScope): string[] {
        const targetClass: Newable<BaseEntity> = metadata.target();
        const targetDriver: InMemoryRepositoryDriver<BaseEntity> = new InMemoryRepositoryDriver(targetClass, this.store);
        const res: string[] = [];

        for (const member of members) {
            const entity: DeepPartial<BaseEntity> = member as DeepPartial<BaseEntity>;
            if (entity.id != undefined) {
                res.push(String(entity.id));
                continue;
            }
            if (!this.hasCascadeInsert(metadata)) {
                throw new InternalError(
                    `Could not save the relation "${this.entityClass.name}.${metadata.inverseSide}": `
                    + `the given ${targetClass.name} has no id and the relation does not cascade inserts.`
                );
            }
            res.push(this.onlyPersisted(targetDriver.persist([entity], scope, true)).id);
        }
        return res;
    }

    /**
     * Stops every many to many relation of a removed row pointing at it.
     * @param id - The id of the row being removed.
     * @param scope - What to write through.
     */
    private removeManyToManyRelations(id: string, scope: InMemoryScope): void {
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (metadata.type !== Relation.MANY_TO_MANY) {
                continue;
            }
            const joinKey: string = this.joinKey(id, key);
            const inverseDriver: InMemoryRepositoryDriver<BaseEntity> = new InMemoryRepositoryDriver(metadata.target(), this.store);

            for (const relatedId of scope.readJoin(joinKey)) {
                const inverseKey: string = inverseDriver.joinKey(relatedId, metadata.inverseSide);
                const members: Set<string> = scope.readJoin(inverseKey);
                members.delete(id);
                scope.writeJoin(inverseKey, members);
            }
            scope.writeJoin(joinKey, new Set());
        }
    }

    /**
     * Checks whether saving an entity should also save the entities of the given relation.
     * @param metadata - The metadata of the relation.
     * @returns True when inserts cascade into the relation, false otherwise.
     */
    private hasCascadeInsert(metadata: RelationMetadata<BaseEntity>): boolean {
        if (this.hasCascadeFlag(metadata.cascade)) {
            return true;
        }
        const inverse: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(metadata.target())[metadata.inverseSide];
        return inverse != undefined && this.isRelation(inverse) && this.hasCascadeFlag(inverse.cascade);
    }

    /**
     * Reads the cascade declaration of one side of a relation.
     * @param cascade - The cascade options of that side.
     * @returns True when it cascades inserts.
     */
    private hasCascadeFlag(cascade: RelationMetadata<BaseEntity>['cascade']): boolean {
        if (cascade === true) {
            return true;
        }
        return Array.isArray(cascade) && cascade.includes('insert');
    }

    /**
     * Encodes the given data into the fields a row stores.
     *
     * Only the properties the data actually carries are written, so an update does not blank out the
     * columns it did not mention. A default is filled in for an insert only.
     * @param data - The data being saved.
     * @param isNew - Whether the row is being inserted rather than updated.
     * @returns The json encoded fields.
     */
    private toFields(data: DeepPartial<T>, isNew: boolean): StoredRow {
        const res: StoredRow = {};

        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (this.isRelation(metadata)) {
                this.applyToOneRelation(data, key, metadata, res);
                continue;
            }

            let value: unknown = (data as Record<string, unknown>)[key];
            if (value === undefined) {
                const defaultValue: unknown = 'default' in metadata ? metadata.default : undefined;
                if (!isNew || defaultValue === undefined) {
                    continue;
                }
                value = typeof defaultValue === 'function' ? (defaultValue as () => unknown)() : defaultValue;
            }
            res[key] = JSON.stringify(this.toStorableValue(value));
        }
        return res;
    }

    /**
     * Writes the foreign key of a to one relation when the relation was provided as a full entity.
     * @param data - The data that is being saved.
     * @param key - The property key of the relation.
     * @param metadata - The metadata of the relation.
     * @param fields - The fields to write the foreign key into.
     */
    private applyToOneRelation(
        data: DeepPartial<T>,
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        fields: StoredRow
    ): void {
        if (metadata.type !== Relation.MANY_TO_ONE && metadata.type !== Relation.BELONGS_TO_ONE) {
            return;
        }
        const value: unknown = (data as Record<string, unknown>)[key];
        if (value == undefined || typeof value !== 'object' || !('id' in value)) {
            return;
        }
        fields[this.resolveJoinColumn(metadata, key)] = JSON.stringify(String(value.id));
    }

    /**
     * Narrows a value to something json can carry, the same way the valkey driver does.
     * @param value - The value being stored.
     * @returns The storable form of it.
     */
    private toStorableValue(value: unknown): unknown {
        if (value instanceof Date) {
            return value.toISOString();
        }
        if (typeof value === 'bigint') {
            return value.toString();
        }
        if (Buffer.isBuffer(value)) {
            return value.toString('base64');
        }
        return value;
    }

    /**
     * Decodes a stored row back into an entity.
     * @param row - The stored row.
     * @returns The entity.
     */
    private fromFields(row: StoredRow): T {
        const res: Record<string, unknown> = {};

        for (const [key, raw] of ObjectUtilities.entries(row)) {
            const metadata: PropertyMetadata | undefined = this.properties[key];
            const parsed: unknown = JSON.parse(raw);
            res[key] = metadata == undefined ? parsed : this.fromStorableValue(parsed, metadata);
        }
        return res as T;
    }

    /**
     * Widens a stored value back to the type its property declares.
     * @param value - The decoded value.
     * @param metadata - The metadata of the property it belongs to.
     * @returns The value as the property declares it.
     */
    private fromStorableValue(value: unknown, metadata: PropertyMetadata): unknown {
        if (value == undefined) {
            return value;
        }
        switch (metadata.type) {
            case 'date': {
                // eslint-disable-next-line typescript/no-base-to-string
                return new Date(String(value));
            }
            case 'number': {
                // eslint-disable-next-line typescript/no-base-to-string
                return metadata.format === 'bigint' ? BigInt(String(value)) : Number(value);
            }
            case 'file': {
                // eslint-disable-next-line typescript/no-base-to-string
                return Buffer.from(String(value), 'base64');
            }
            case 'object': {
                return parseObject(value, metadata.cls());
            }
            case 'array': {
                return parseArray(value, metadata.items);
            }
            case 'oneOf': {
                return parseOneOf(value, metadata);
            }
            case 'string':
            case 'boolean':
            case Relation.HAS_ONE:
            case Relation.BELONGS_TO_ONE:
            case Relation.ONE_TO_MANY:
            case Relation.MANY_TO_ONE:
            case Relation.MANY_TO_MANY:
            case 'unknown': {
                return value;
            }
        }
    }

    /**
     * Sorts the given entities by the requested order.
     * @param entities - The entities to sort.
     * @param order - The requested order.
     * @returns The sorted entities, or the given ones when no order was requested.
     */
    private applyOrder(entities: T[], order: DriverFindOptions<T>['order']): T[] {
        if (order == undefined) {
            return entities;
        }
        // a property of one of the entities this reached through is compared exactly as a property
        // of the entity is - the only difference is how far the value is reached through, which the
        // key carries
        const keys: OrderKey[] = EntityOrderUtilities.resolveKeys(order);
        if (!keys.length) {
            return entities;
        }

        return [...entities].sort((a, b) => {
            for (const { path, direction } of keys) {
                const comparison: number = this.compareValues(
                    EntityOrderUtilities.valueAt(a, path),
                    EntityOrderUtilities.valueAt(b, path)
                );
                if (comparison !== 0) {
                    return direction === 'DESC' ? -comparison : comparison;
                }
            }
            return 0;
        });
    }

    /**
     * Compares two values of the same property.
     * @param a - The first value.
     * @param b - The second value.
     * @returns A negative number when a sorts first, a positive one when b does, 0 when they tie.
     */
    // eslint-disable-next-line sonar/cognitive-complexity
    private compareValues(a: unknown, b: unknown): number {
        if (a == undefined && b == undefined) {
            return 0;
        }
        // nulls last, mirroring the default of postgres for ascending order
        if (a == undefined) {
            return 1;
        }
        if (b == undefined) {
            return -1;
        }
        if (a instanceof Date || b instanceof Date) {
            return new Date(a as string).getTime() - new Date(b as string).getTime();
        }
        if (typeof a === 'number' && typeof b === 'number') {
            return a - b;
        }
        if (typeof a === 'bigint' && typeof b === 'bigint') {
            return a === b ? 0 : a < b ? -1 : 1;
        }
        if (typeof a === 'boolean' && typeof b === 'boolean') {
            return Number(a) - Number(b);
        }
        // eslint-disable-next-line typescript/no-base-to-string
        return String(a).localeCompare(String(b));
    }

    /**
     * Produces the id of a row that was saved without one.
     * @param scope - What to take a sequence value from, for a numeric primary key.
     * @returns The generated id.
     */
    private generateId(scope: InMemoryScope): string {
        const primary: [string, PropertyMetadata] | undefined = ObjectUtilities
            .entries(this.properties)
            .find(([, m]) => 'primary' in m && m.primary);

        if (primary?.[1].type === 'number') {
            return scope.nextSequenceValue(this.tableName).toString();
        }
        return UUIDUtilities.generate();
    }

    /**
     * Checks whether the given property is a relation.
     * @param metadata - The metadata of the property.
     * @returns True when it is a relation of any kind.
     */
    private isRelation(metadata: PropertyMetadata | undefined): metadata is RelationMetadata<BaseEntity> {
        return metadata?.type === Relation.HAS_ONE
            || metadata?.type === Relation.BELONGS_TO_ONE
            || metadata?.type === Relation.MANY_TO_ONE
            || metadata?.type === Relation.ONE_TO_MANY
            || metadata?.type === Relation.MANY_TO_MANY;
    }

    /**
     * Reads the column a to one relation stores its foreign key in.
     * @param metadata - The metadata of the relation.
     * @param key - The property key, for the error message.
     * @returns The name of the join column.
     * @throws When the relation does not declare one.
     */
    private resolveJoinColumn(metadata: RelationMetadata<BaseEntity>, key: string): string {
        if (
            (metadata.type === Relation.MANY_TO_ONE || metadata.type === Relation.BELONGS_TO_ONE)
            && metadata.joinColumn != undefined
        ) {
            return metadata.joinColumn;
        }
        throw new InternalError(`The relation "${this.entityClass.name}.${key}" needs to have "joinColumn" set.`);
    }

    /**
     * Reads the column the other side of a to many relation stores its foreign key in.
     * @param metadata - The metadata of the relation on this side.
     * @param key - The property key, for the error message.
     * @returns The name of the join column on the inverse side.
     * @throws When the inverse side is missing or is not a relation.
     */
    private requireInverseJoinColumn(metadata: RelationMetadata<BaseEntity>, key: string): string {
        const targetClass: Newable<BaseEntity> = metadata.target();
        const inverse: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(targetClass)[metadata.inverseSide];

        if (inverse == undefined || !this.isRelation(inverse)) {
            throw new InternalError(
                `Could not find the inverse relation "${metadata.inverseSide}" on ${targetClass.name} for ${this.entityClass.name}.${key}.`
            );
        }
        return this.resolveJoinColumn(inverse, metadata.inverseSide);
    }

    /**
     * The key that one side of a many to many relation keeps its related ids under.
     * @param id - The id of the row.
     * @param propertyKey - The property key of the relation.
     * @returns The join key.
     */
    private joinKey(id: string, propertyKey: string): string {
        return `${this.tableName}:${id}:${propertyKey}`;
    }

    private onlyPersisted<R>(rows: R[]): R {
        const row: R | undefined = rows[0];
        if (row == undefined) {
            throw new InternalError('Persisting one entity returned no row.');
        }
        return row;
    }
}