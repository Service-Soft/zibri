import type { GlideClient, GlideString, HashDataType } from '@valkey/valkey-glide';

import { DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { PropertyMetadata, RelationMetadata } from '../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../entity/entity-metadata-missing.error';
import { EntityOrderUtilities, OrderKey } from '../../entity/models/entity-order.utilities';
import { RelationTree, RelationTreeByRowId } from '../../entity/models/entity-relations.model';
import { EntityRelationsUtilities } from '../../entity/models/entity-relations.utilities';
import { Relation } from '../../entity/models/relation.enum';
import { coversEveryRow, UniqueGroup } from '../../entity/models/unique-declaration.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { ModelRegistry } from '../../global/model-registry/model.registry';
import { PaginationResult } from '../../open-api/pagination-result.model';
import { parseArray } from '../../parsing/functions/parse-array.function';
import { parseObject } from '../../parsing/functions/parse-object.function';
import { parseOneOf } from '../../parsing/functions/parse-one-of.function';
import { toJsonValue } from '../../parsing/functions/to-json-value.function';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { readNumber } from '../../utilities/read-number.function';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { type ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { WhereFilterEvaluator } from '../data-sources/where-converter/where-filter.evaluator';
import { AtomicUpdate } from '../models/atomic-update.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';
import { ValKeyTransaction } from '../transaction/val-key-transaction.model';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';
import { uniqueGroupFor } from '../unique-group-for.function';
import { upsertConflictWhere } from '../upsert-conflict-where.function';

/**
 * How many rows a stream reads back at once.
 *
 * The bound on what a stream holds: the ids are read in one go because that is the small half, and
 * the rows behind them - which is what would not fit - are read a batch at a time.
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
 * A row a save has written, carried out of the concurrent pass so that its unique declarations can
 * be claimed one row at a time afterwards.
 */
type WrittenRow = {
    /**
     * The id the row was written under.
     */
    id: string,
    /**
     * The fields as the row stores them, so a value is indexed under what was actually written.
     */
    fields: Record<string, string>,
    /**
     * The stored row, when the save was an update rather than an insert.
     */
    existing: Record<string, string> | undefined,
    /**
     * The rows of each to many and has one relation that were written along with it, as they were
     * stored. Empty unless the save reloads.
     */
    children: Map<string, BaseEntity[]>
};

/**
 * The repository driver that reads and writes entities from and to a valkey server.
 *
 * ## Key layout
 * Every entity is stored as a hash under `{prefix}:{tableName}:{id}`, where each field holds one json
 * encoded column value. All ids of an entity are additionally kept in the set `{prefix}:{tableName}:ids`
 * so that finding entities does not need to scan the whole keyspace. Many to many relations are stored
 * as a set of the related ids under `{prefix}:{tableName}:{id}:{propertyKey}`.
 *
 * Anything declared unique - a property with `unique`, or a group in the entity's `uniques` - also
 * gets an index under `{prefix}:{tableName}:unique:{...}`, holding the id of the row that carries
 * those values.
 *
 * ## Unique declarations
 * That index is also what enforces them. A save reads it under a grant on the index key and refuses
 * the write with a {@link UniqueConstraintViolationError} when another row is already there, which is
 * the same answer a sql store gives to the same declaration. It costs a grant and a read per changed
 * value, so a save only pays it for a declaration whose value it is actually taking up: an update
 * that leaves the value alone, and every entity that declares nothing unique, pay nothing.
 *
 * ## Filtering
 * Valkey cannot filter hashes server side, so entities are loaded and then filtered in process by the
 * {@link WhereFilterEvaluator}. Relations are only resolved when the filter or the requested relations
 * actually need them.
 *
 * Two filters avoid loading everything: one that pins the id, and one that pins everything a unique
 * declaration names. The second is a shortcut rather than an authority - a miss falls back to reading
 * every row, because a row stored before its index existed has no entry and must not be reported as
 * absent.
 */
export class ValKeyRepositoryDriver<T extends BaseEntity> implements RepositoryDriverInterface<T> {

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
        private readonly client: GlideClient,
        private readonly keyPrefix: string,
        private readonly dataSource: ValKeyDataSource
    ) {
        const metadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(entityClass);
        if (!metadata) {
            throw new EntityMetadataMissingError(entityClass);
        }
        this.tableName = metadata.tableName;
        this.properties = MetadataUtilities.getModelProperties(entityClass);
        this.uniqueGroups = this.resolveUniqueGroups();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        // a unique declaration is only enforceable while nobody else can be writing the same value,
        // and what holds a key against everybody else is a grant, which lives on a transaction. A
        // save that was given one has somewhere to keep that grant already; a save that was not takes
        // a transaction of its own - but only when the entity declares something to enforce, so an
        // entity without one keeps writing exactly as directly as it did before.
        if (!this.uniqueGroups.length) {
            return await this.saveThrough(data, this.toValKeyTransaction(transaction), reload);
        }
        return await this.inTransaction(transaction, async own => await this.saveThrough(data, own, reload));
    }

    /**
     * Writes the rows, their indexes and their relations.
     * @param data - The rows to write.
     * @param valKeyTransaction - The transaction to write through, when there is one.
     * @param reload - Whether or not the written rows should be read back.
     * @returns The written rows when they were reloaded, an empty array otherwise.
     */
    private async saveThrough(data: DeepPartial<T>[], valKeyTransaction: ValKeyTransaction | undefined, reload: boolean): Promise<T[]> {
        // assigned in order, and before anything else: an entity with a numeric primary key takes
        // its id from an INCR. Generating those alongside the writes would let the round trips race,
        // so saving three rows would hand the numbers out in whatever order they came back and the
        // caller's first entity could end up with the highest id.
        // paired rather than kept in a second array beside data, so that nothing has to line the two
        // up by position afterwards
        const entriesWithIds: [DeepPartial<T>, string][] = [];
        for (const entry of data) {
            entriesWithIds.push([entry, entry.id ?? await this.generateId()]);
        }
        const ids: string[] = entriesWithIds.map(([, id]) => id);

        // the entries are independent once they have their ids: each writes its own row key and its
        // own join keys, and the single key they share - the id set - only ever has members added
        const written: WrittenRow[] = await Promise.all(entriesWithIds.map(async ([entry, id]) => {
            const existing: Record<string, string> | undefined = await this.readRow(id, valKeyTransaction);
            const fields: Record<string, string> = this.toFields(entry, existing == undefined);

            await this.write({ type: 'hashSet', key: this.rowKey(id), values: { ...fields, id: JSON.stringify(id) } }, valKeyTransaction);
            await this.write({ type: 'setAdd', key: this.idsKey(), members: [id] }, valKeyTransaction);
            const children: Map<string, BaseEntity[]> = await this.saveToManyRelations(id, entry, valKeyTransaction, reload);
            await this.saveManyToManyRelations(id, entry, valKeyTransaction);

            return { id, fields, existing, children };
        }));

        // one row at a time, and the only part of a save that is. A unique index key is the second
        // key the rows of one save share, and unlike the id set it is the one whose entire point is
        // that at most one row may hold a value - so a claim has to see what the rows before it in
        // this same save have taken. Run concurrently, all of them read the index before any of them
        // has written to it, so a batch carrying one value twice passed every check and stored both.
        //
        // Nothing is paid for this by an entity that declares nothing unique: `uniqueGroups` is
        // empty, so each pass does no work, and every write above stays as concurrent as it was.
        // A violation leaves nothing behind - `save` runs this inside a transaction whenever there
        // is anything to enforce, and everything above is buffered in it until it commits.
        for (const row of written) {
            await this.saveUniqueIndexes(row.id, row.fields, row.existing, valKeyTransaction);
        }

        if (!reload) {
            return [];
        }
        // with the relations each row's data wrote, as they were stored, so a caller gets the ids of
        // the rows created along with it. The rows of a to many relation are the ones this save just
        // wrote rather than read again, which on a key value store would read the whole target table
        const relationsById: Map<string, RelationTree> = new Map(
            entriesWithIds.map(([entry, id]) => [id, this.providedKeyRelations(entry)])
        );
        const res: T[] = await this.findByIds(ids, { transaction: valKeyTransaction }, valKeyTransaction, relationsById);
        for (const entity of res) {
            for (const [key, children] of written.find(w => w.id === entity.id)?.children ?? []) {
                (entity as Record<string, unknown>)[key] = this.properties[key]?.type === Relation.HAS_ONE ? children.at(0) : children;
            }
        }
        return res;
    }

    /**
     * The relations the given data provides a value for that are read back by the ids they hold: a
     * many to many relation, and a to one relation given as an entity.
     * @param data - The data being saved.
     * @returns Their keys, each with nothing below it: a write hands back the rows it wrote and the
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async find(options: DriverFindOptions<T>): Promise<T[]> {
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(options.transaction);
        // a filter that pins the id, or everything a unique declaration names, can read the rows
        // directly instead of going through every entity
        const ids: string[] = this.idsFromFilter(options.where)
            ?? await this.idsFromUniqueFilter(options.where, valKeyTransaction)
            ?? await this.readIds(valKeyTransaction);
        const entities: T[] = await this.findByIds(ids, options, valKeyTransaction);

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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        return (await this.find({ ...options, skip: undefined, take: 1 })).at(0);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        // one read rather than two. Valkey has no snapshot to hold two reads together in - a
        // transaction here is a set of grants on the rows it writes, which says nothing about what
        // a reader sees - so the closest a page and a total can get to describing one moment is to
        // be taken from the same set of rows. It is also the cheaper of the two: a filtered `count`
        // here is a whole second `find`, and the window was being applied to a set this already had.
        const counted: T[] = await this.find({
            ...options,
            where: options.totalWhere ?? options.where,
            skip: undefined,
            take: undefined
        });
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(options.transaction);
        // the ids, then the rows a page at a time. There is no cursor to hold here and nothing to
        // gain from one: valkey answers a filter in this process anyway, so what a stream saves is
        // holding every *row* at once, and the id set is the small half. It is read once, so which
        // rows the stream covers is decided when it starts - the same thing a cursor decides.
        const ids: string[] = this.idsFromFilter(options.where)
            ?? await this.idsFromUniqueFilter(options.where, valKeyTransaction)
            ?? await this.readIds(valKeyTransaction);

        for (let i: number = 0; i < ids.length; i += STREAM_BATCH_SIZE) {
            const entities: T[] = await this.findByIds(ids.slice(i, i + STREAM_BATCH_SIZE), options, valKeyTransaction);
            for (const entity of entities) {
                if (options.where && !this.evaluator.matches(entity, options.where, this.entityClass)) {
                    continue;
                }
                yield entity;
            }
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async count(options: DriverFindOptions<T>): Promise<number> {
        if (!options.where) {
            return (await this.readIds(this.toValKeyTransaction(options.transaction))).length;
        }
        return (await this.find({ where: options.where, transaction: options.transaction })).length;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAll<R extends boolean = false>(
        options: DriverUpdateAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        // there is no statement here that selects rows and writes them at once, so the rows have to
        // be held from the moment they are read until the moment they are written - which is what a
        // transaction is on this store. Taken here when the caller passed none, the same way a save
        // enforcing a unique declaration takes one
        return await this.inTransaction(
            options.transaction,
            async valKeyTransaction => await this.updateThroughHeldRows(options, valKeyTransaction)
        );
    }

    /**
     * Applies the change to the rows a filter matches, while holding each of them.
     * @param options - What to change, where, and whether the changed entities are wanted back.
     * @param valKeyTransaction - The transaction the rows are held in.
     * @returns How many rows it wrote, or those rows when they were asked for.
     */
    private async updateThroughHeldRows<R extends boolean>(
        options: DriverUpdateAllOptions<T, R>,
        valKeyTransaction: ValKeyTransaction
    ): Promise<R extends true ? T[] : number> {
        const { where, data, returnUpdated }: DriverUpdateAllOptions<T, R> = options;

        const matched: T[] = await this.holdRowsMatching(where, valKeyTransaction);
        if (!matched.length) {
            return (returnUpdated === true ? [] : 0) as R extends true ? T[] : number;
        }

        // the write is what knows which rows it wrote, so it is what hands them back. Reading them
        // again would also have to read them by id rather than by re-running the filter: the update
        // may well have changed a column the filter matches on - updateAll({ status: 'QUEUED' },
        // { status: 'SENT' }) being the obvious case - and re-running it then returns the rows that
        // were *not* touched
        const updated: T[] = await this.save(
            matched.map(m => ({ ...data, id: m.id })),
            valKeyTransaction,
            returnUpdated === true
        );
        return (returnUpdated === true ? updated : matched.length) as R extends true ? T[] : number;
    }

    /**
     * Takes hold of every row a filter matches, and reads them as they stand once held.
     * @param where - The filter selecting the rows.
     * @param valKeyTransaction - The transaction the rows are held in.
     * @returns The rows, as they are now that nobody else can write them.
     */
    private async holdRowsMatching(where: Where<T> | undefined, valKeyTransaction: ValKeyTransaction): Promise<T[]> {
        // an id is the one thing a filter can say that a write cannot make untrue: a row either
        // exists or it does not, and the id of one never changes. So the rows it names can be held
        // straight away and read once, where a filter saying anything else has to be evaluated
        // again afterwards
        const named: string[] | undefined = this.idsNamedBy(where);
        if (named) {
            await this.claimRows(named, valKeyTransaction);
            return await this.findByIds(named, { transaction: valKeyTransaction }, valKeyTransaction);
        }

        // read while holding nothing, because a filter cannot name its rows until it has read them.
        // Nothing is trusted from this read except which rows to hold.
        const candidates: T[] = await this.find({ where, transaction: valKeyTransaction });
        if (!candidates.length) {
            return [];
        }
        await this.claimRows(candidates.map(c => c.id), valKeyTransaction);

        // read again now that the rows are held, and this is the read that counts. One of them may
        // have been changed by a single row write while this was queueing for it, and a row that
        // stopped matching by then is dropped - which is what a database does once it has been
        // granted a row lock.
        const held: Set<string> = new Set(candidates.map(c => c.id));
        return (await this.find({ where, transaction: valKeyTransaction })).filter(m => held.has(m.id));
    }

    /**
     * Takes hold of the given rows, so that nobody else writes them until this transaction ends.
     * @param ids - The ids of the rows to hold.
     * @param valKeyTransaction - The transaction to hold them in.
     */
    private async claimRows(ids: string[], valKeyTransaction: ValKeyTransaction): Promise<void> {
        // sorted, so that two of these overlapping take the rows they share in the same order rather
        // than in opposite ones. The alternative - holding the whole entity - would serialize filter
        // writes that match nothing in common, which is a cost the sort avoids entirely.
        for (const id of [...ids].sort()) {
            await valKeyTransaction.claimKey(this.rowKey(id));
        }
    }

    /**
     * The ids a filter pins, when pinning them is the whole of what it asks.
     * @param where - The filter to read.
     * @returns The ids, or undefined when the filter asks anything besides them.
     */
    private idsNamedBy(where: Where<T> | undefined): string[] | undefined {
        const ids: string[] | undefined = this.idsFromFilter(where);
        if (ids == undefined || where == undefined) {
            return undefined;
        }
        const filters: WhereFilter<T>[] = Array.isArray(where) ? where : [where];
        return filters.every(f => Object.keys(f).length === 1) ? ids : undefined;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
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
        const identityKey: string = this.upsertKey(identity);

        return await this.inTransaction(transaction, async valKeyTransaction => {
            // before the read, which is the whole of what makes this atomic. Valkey has no statement
            // that resolves a row by anything other than its key, so the row has to be looked for -
            // and a grant taken after that look would leave the value it found already stale.
            await valKeyTransaction.claimKey(identityKey);

            // the rows this may land on are the ones the key covers, which is not every row holding
            // the identity's values: a key over part of a table leaves the rest free
            const found: T | undefined = await this.findOne({
                where: upsertConflictWhere(this.entityClass, identity),
                transaction: valKeyTransaction
            });
            if (found == undefined) {
                return this.onlySaved(await this.save([create], valKeyTransaction, true));
            }

            // the row is only identified by the read above, so its own grant can only be taken after
            // it - and a plain write may have been holding that grant, and committing, the whole time
            // the read was happening. Reading again once it is held is what makes the value this adds
            // to the value that is actually stored, rather than the one that was stored a moment ago.
            await valKeyTransaction.claimKey(this.rowKey(found.id));
            const existing: T | undefined = (await this.findByIds([found.id], {}, valKeyTransaction)).at(0);
            if (existing == undefined) {
                return this.onlySaved(await this.save([create], valKeyTransaction, true));
            }

            const updated: Record<string, unknown> = { id: existing.id };
            for (const [key, change] of changes) {
                updated[key] = 'increment' in change
                    ? Number((existing as Record<string, unknown>)[key]) + change.increment
                    : change.set;
            }
            return this.onlySaved(await this.save([updated as DeepPartial<T>], valKeyTransaction, true));
        });
    }

    /**
     * Runs the given work inside a valkey transaction, taking one out when the caller passed none.
     *
     * An upsert is only atomic for as long as its grant is held, and a grant is handed back when the
     * transaction that took it ends. Without a transaction of its own there would be nothing to end,
     * so an upsert outside one would hold its grant until it lapsed.
     * @param transaction - The transaction the caller provided, if any.
     * @param fn - The work to run.
     * @returns Whatever the work returned.
     */
    private async inTransaction<R>(
        transaction: Transaction | undefined,
        fn: (valKeyTransaction: ValKeyTransaction) => Promise<R>
    ): Promise<R> {
        const provided: ValKeyTransaction | undefined = this.toValKeyTransaction(transaction);
        if (provided) {
            return await fn(provided);
        }

        const own: ValKeyTransaction | undefined = this.toValKeyTransaction(this.dataSource.startTransaction());
        if (!own) {
            throw new InternalError('The valkey data source did not return a valkey transaction.');
        }
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

    /**
     * Builds the key that upserts of the same identity contend for.
     *
     * Derived from the identity rather than from a row, because the row may not exist yet - two
     * instances inserting the same identity at the same time are exactly the case this covers, and
     * neither of them has a row key to name. Sorted, so the order the caller wrote the identity in
     * does not change which key it lands on.
     * @param identity - The properties identifying the row, and their values.
     * @returns The key to hold for the upsert.
     */
    private upsertKey(identity: DeepPartial<T>): string {
        const group: UniqueGroup = uniqueGroupFor(this.entityClass, Object.keys(identity));
        const values: string = [...group.properties]
            .sort()
            .map(key => `${key}=${JSON.stringify((identity as Record<string, unknown>)[key])}`)
            .join(':');
        return `${this.keyPrefix}:${this.tableName}:upsert:${values}`;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async remove(entities: T[], transaction: Transaction | undefined): Promise<T[]> {
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(transaction);

        // nothing has to happen in order first, unlike save: every entity already knows its own id,
        // so there is no sequence to hand out, and the one key they share - the id set - only ever
        // has members removed from it
        await Promise.all(entities.map(async entity => {
            await this.removeManyToManyRelations(entity.id, valKeyTransaction);
            await this.write({ type: 'delete', key: this.rowKey(entity.id) }, valKeyTransaction);
            await this.write({ type: 'setRemove', key: this.idsKey(), members: [entity.id] }, valKeyTransaction);
            await this.removeUniqueIndexes(entity, valKeyTransaction);
        }));
        return entities;
    }

    /**
     * Points every unique declaration this row satisfies at it, and stops pointing the values it no
     * longer has.
     *
     * Giving a value up is written as a plain set operation, for the reason the id set is: removals
     * commute, so two rows letting go of different values never have to be ordered against each other
     * and neither has to take a grant. Taking one up does not commute - that is the whole of what
     * unique means - so it goes through {@link claimUniqueValues} instead.
     * @param id - The id of the row being written.
     * @param fields - The fields being written, exactly as the row stores them. Taken from the
     * caller rather than recomputed, so that a default filled in for a new row is indexed under the
     * value that was actually stored.
     * @param existing - The stored row, when there was one.
     * @param transaction - The transaction to write through.
     * @throws When another row already holds the values one of the declarations names.
     */
    private async saveUniqueIndexes(
        id: string,
        fields: Record<string, string>,
        existing: Record<string, string> | undefined,
        transaction: ValKeyTransaction | undefined
    ): Promise<void> {
        // the groups touch keys none of the others do, so they are written together the same way the
        // rows of one save are
        await Promise.all(this.uniqueGroups.map(async group => {
            const previous: string | undefined = existing == undefined || !this.coveredBy(group, existing)
                ? undefined
                : this.uniqueValuesOf(group.properties, existing);
            // an update carries only some properties, so what the row ends up holding is the stored
            // row with the write applied over it
            const stored: Record<string, string> = { ...existing, ...fields };
            // a row the declaration does not cover holds nothing as far as it is concerned, which is
            // also how a row leaves the index by being soft deleted rather than by changing the value
            const next: string | undefined = this.coveredBy(group, stored)
                ? this.uniqueValuesOf(group.properties, stored)
                : undefined;
            if (previous === next) {
                return;
            }
            if (previous != undefined) {
                await this.write(
                    { type: 'setRemove', key: this.uniqueKey(group.properties, previous), members: [id] },
                    transaction
                );
            }
            if (next != undefined) {
                await this.claimUniqueValues(group.properties, next, id, transaction);
                await this.write({ type: 'setAdd', key: this.uniqueKey(group.properties, next), members: [id] }, transaction);
            }
        }));
    }

    /**
     * Refuses the write when another row already holds the values a unique declaration names.
     *
     * The grant comes before the read for the reason an upsert's does: an index cannot say who holds
     * a value until it has been read, and a grant taken afterwards would leave that answer already
     * stale. Holding it until the transaction ends is what makes the check and the write following it
     * one step as far as every other writer is concerned - two instances inserting the same value at
     * the same time is exactly the case this covers, and neither of them has a row to hold instead.
     *
     * Reading through the transaction rather than around it also settles the case both rows are in
     * one save: the first has already added itself to the overlay by the time the second looks.
     *
     * A row written before this index existed carries no entry and therefore cannot be seen from
     * here. That is the same gap the read side answers by falling back to reading every row, and it
     * closes for a row the next time that row is written.
     * @param group - The properties of the unique declaration.
     * @param values - The values the row will hold for them, encoded the way the index stores them.
     * @param id - The id of the row being written.
     * @param transaction - The transaction holding the grant. Always present, because `save` takes a
     * transaction of its own whenever the entity declares anything unique.
     * @throws When another row already holds these values.
     */
    private async claimUniqueValues(
        group: string[],
        values: string,
        id: string,
        transaction: ValKeyTransaction | undefined
    ): Promise<void> {
        const key: string = this.uniqueKey(group, values);
        await transaction?.claimKey(key);

        // the row's own id is not a conflict - a row is never a duplicate of itself - so this asks
        // whether anybody *else* is there rather than whether anything is
        const holder: string | undefined = (await this.readSet(key, transaction)).find(h => h !== id);
        if (holder != undefined) {
            throw new UniqueConstraintViolationError(this.entityClass.name, group);
        }
    }

    /**
     * Stops every unique declaration of a deleted row pointing at it.
     * @param entity - The row being removed.
     * @param transaction - The transaction to write through.
     */
    private async removeUniqueIndexes(entity: T, transaction: ValKeyTransaction | undefined): Promise<void> {
        const fields: Record<string, string> = this.toFields(entity as unknown as DeepPartial<T>, false);

        await Promise.all(this.uniqueGroups.map(async group => {
            // re-encoded through the same function that wrote the row, so that the key built here is
            // the key the write built rather than one that merely looks like it
            const values: string | undefined = this.uniqueValuesOf(group.properties, fields);
            if (values != undefined) {
                await this.write(
                    { type: 'setRemove', key: this.uniqueKey(group.properties, values), members: [entity.id] },
                    transaction
                );
            }
        }));
    }

    /**
     * Collects every set of properties that names at most one row.
     *
     * Sorted and de-duplicated here rather than taken as declared: the keys this driver builds are
     * derived from the group, so two declarations naming the same columns in a different order have
     * to arrive at the same key.
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
                // the rows a group covers are part of what makes it that group: the same columns
                // over different rows are two declarations, and they need two keys to be enforced by
                const id: string = `${g.properties.join(',')}|${g.where == undefined ? '' : JsonUtilities.stringify(g.where)}`;
                if (seen.has(id)) {
                    return false;
                }
                seen.add(id);
                return true;
            });
    }

    /**
     * Whether a row belongs to the rows a unique declaration covers.
     *
     * A row the declaration leaves out is not indexed under it, which is the whole of what a partial
     * unique does: the value it holds stays free for everybody else.
     * @param group - The declaration.
     * @param fields - The row as it will be stored, json encoded.
     * @returns True when the declaration applies to this row.
     */
    private coveredBy(group: UniqueGroup, fields: Record<string, string>): boolean {
        if (group.where == undefined || coversEveryRow(group.where)) {
            return true;
        }
        return this.evaluator.matches(this.fromFields(fields), group.where as Where<T>, this.entityClass);
    }

    /**
     * Reads the values a group names off a stored row.
     * @param group - The properties of the unique declaration.
     * @param fields - The row, as the json encoded fields it is stored as.
     * @returns The values as one string, or undefined when the row does not carry all of them - a
     * row missing part of a group is not named by it and is therefore not indexable under it.
     */
    private uniqueValuesOf(group: string[], fields: Record<string, string>): string | undefined {
        const values: string[] = [];
        for (const key of group) {
            if (fields[key] == undefined) {
                return undefined;
            }
            values.push(`${key}=${fields[key]}`);
        }
        return values.join(':');
    }

    /**
     * Loads the entities with the given ids and resolves their relations when they are needed.
     * @param ids - The ids of the entities to load.
     * @param options - The find options, used to determine which relations need to be resolved.
     * @param transaction - The transaction to read through.
     * @param relationsById - The relations to resolve on a row in place of the ones the options name,
     * by the id of the row.
     * @returns The loaded entities, in the order of the ids, skipping ids that hold no row.
     */
    private async findByIds(
        ids: string[],
        options: DriverFindOptions<T>,
        transaction: ValKeyTransaction | undefined,
        relationsById?: RelationTreeByRowId
    ): Promise<T[]> {
        const relationsToResolve: RelationTree = this.relationsToResolve(options);

        const entities: (T | undefined)[] = await PromiseUtilities.allChunked(ids, async id => {
            const row: Record<string, string> | undefined = await this.readRow(id, transaction);
            if (row == undefined) {
                return undefined;
            }
            const entity: T = this.fromFields(row);
            await this.resolveRelations(entity, relationsById?.get(id) ?? relationsToResolve, transaction);
            return entity;
        });
        return entities.filter(e => e != undefined);
    }

    /**
     * Determines which relations need to be resolved for the given options.
     *
     * Relations are expensive on a key value store, so only the ones that were explicitly requested
     * and the ones the filter or the order cannot be answered without are loaded. The last two are
     * taken off the rows again once the read is done, since neither is a caller asking for one.
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

    private async resolveRelations(entity: T, relations: RelationTree, transaction: ValKeyTransaction | undefined): Promise<void> {
        for (const [key, below] of relations) {
            const metadata: PropertyMetadata | undefined = this.properties[key];
            if (metadata == undefined || !this.isRelation(metadata)) {
                continue;
            }
            (entity as Record<string, unknown>)[key] = await this.resolveRelation(entity, key, metadata, below, transaction);
        }
    }

    private async resolveRelation(
        entity: T,
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        below: RelationTree,
        transaction: ValKeyTransaction | undefined
    ): Promise<unknown> {
        const targetClass: Newable<BaseEntity> = metadata.target();
        const targetDriver: ValKeyRepositoryDriver<BaseEntity> = new ValKeyRepositoryDriver(
            targetClass,
            this.client,
            this.keyPrefix,
            this.dataSource
        );

        switch (metadata.type) {
            case Relation.MANY_TO_ONE:
            case Relation.BELONGS_TO_ONE: {
                const foreignKey: unknown = (entity as Record<string, unknown>)[this.resolveJoinColumn(metadata, key)];
                if (foreignKey == undefined) {
                    return undefined;
                }
                // eslint-disable-next-line typescript/no-base-to-string
                return (await targetDriver.findByIds([String(foreignKey)], { relations: below }, transaction)).at(0);
            }
            case Relation.ONE_TO_MANY:
            case Relation.HAS_ONE: {
                const inverse: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(targetClass)[metadata.inverseSide];
                if (inverse == undefined || !this.isRelation(inverse)) {
                    throw new InternalError(
                        // eslint-disable-next-line stylistic/max-len
                        `Could not find the inverse relation "${metadata.inverseSide}" on ${targetClass.name} for ${this.entityClass.name}.${key}.`
                    );
                }
                const foreignKeyColumn: string = this.resolveJoinColumn(inverse, metadata.inverseSide);
                // through the transaction, so that rows written in it and not yet committed are found
                const targets: BaseEntity[] = await targetDriver.find({
                    where: { [foreignKeyColumn]: entity.id } as Where<BaseEntity>,
                    relations: below,
                    transaction
                });
                return metadata.type === Relation.HAS_ONE ? targets.at(0) : targets;
            }
            case Relation.MANY_TO_MANY: {
                const ids: string[] = await this.readSet(this.joinKey(entity.id, key), transaction);
                return await targetDriver.findByIds(ids, { relations: below }, transaction);
            }
        }
    }

    /**
     * Persists the entities of a one to many or has one relation that were provided with the given data.
     *
     * Just like a sql data source, this only happens when the relation (or its inverse side) has the
     * cascade insert flag set, otherwise the provided entities are ignored.
     * @param id - The id of the entity that was saved.
     * @param data - The data that was saved.
     * @param transaction - The transaction to run the operation in.
     * @param reload - Whether the written entities should be read back.
     * @returns The written entities of each relation by its key, when they were read back.
     */
    private async saveToManyRelations(
        id: string,
        data: DeepPartial<T>,
        transaction: ValKeyTransaction | undefined,
        reload: boolean
    ): Promise<Map<string, BaseEntity[]>> {
        const res: Map<string, BaseEntity[]> = new Map();
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (metadata.type !== Relation.ONE_TO_MANY && metadata.type !== Relation.HAS_ONE) {
                continue;
            }
            const value: unknown = (data as Record<string, unknown>)[key];
            if (value == undefined || !this.hasCascadeInsert(metadata)) {
                continue;
            }

            const targetClass: Newable<BaseEntity> = metadata.target();
            const inverse: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(targetClass)[metadata.inverseSide];
            if (inverse == undefined || !this.isRelation(inverse)) {
                throw new InternalError(
                    // eslint-disable-next-line stylistic/max-len
                    `Could not find the inverse relation "${metadata.inverseSide}" on ${targetClass.name} for ${this.entityClass.name}.${key}.`
                );
            }

            const foreignKeyColumn: string = this.resolveJoinColumn(inverse, metadata.inverseSide);
            const children: unknown[] = Array.isArray(value) ? value : [value];
            const targetDriver: ValKeyRepositoryDriver<BaseEntity> = new ValKeyRepositoryDriver(
                targetClass,
                this.client,
                this.keyPrefix,
                this.dataSource
            );

            const saved: BaseEntity[] = await targetDriver.save(
                children.map(c => ({ ...c as DeepPartial<BaseEntity>, [foreignKeyColumn]: id })),
                transaction,
                reload
            );
            if (reload) {
                res.set(key, saved);
            }
        }
        return res;
    }

    private async saveManyToManyRelations(
        id: string,
        data: DeepPartial<T>,
        transaction: ValKeyTransaction | undefined
    ): Promise<void> {
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
            const current: string[] = await this.readSet(joinKey, transaction);
            const next: string[] = await this.resolveRelatedIds(metadata, value, transaction);

            const toRemove: string[] = current.filter(c => !next.includes(c));
            if (toRemove.length) {
                await this.write({ type: 'setRemove', key: joinKey, members: toRemove }, transaction);
            }
            if (next.length) {
                await this.write({ type: 'setAdd', key: joinKey, members: next }, transaction);
            }

            // both sides of the relation keep their own set, so the inverse side has to be updated too
            const inverseDriver: ValKeyRepositoryDriver<BaseEntity> = new ValKeyRepositoryDriver(
                metadata.target(),
                this.client,
                this.keyPrefix,
                this.dataSource
            );
            for (const relatedId of toRemove) {
                await this.write(
                    { type: 'setRemove', key: inverseDriver.joinKey(relatedId, metadata.inverseSide), members: [id] },
                    transaction
                );
            }
            for (const relatedId of next.filter(n => !current.includes(n))) {
                await this.write(
                    { type: 'setAdd', key: inverseDriver.joinKey(relatedId, metadata.inverseSide), members: [id] },
                    transaction
                );
            }
        }
    }

    /**
     * Resolves the ids of the members of a many to many relation.
     *
     * Members that do not have an id yet are inserted first, but only when the relation has the
     * cascade insert flag set. Without it they cannot be referenced and are rejected.
     * @param metadata - The metadata of the relation.
     * @param members - The members that were provided with the saved data.
     * @param transaction - The transaction to run the operation in.
     * @returns The ids of the members.
     * @throws When a member has no id and the relation does not cascade inserts.
     */
    private async resolveRelatedIds(
        metadata: RelationMetadata<BaseEntity>,
        members: unknown[],
        transaction: ValKeyTransaction | undefined
    ): Promise<string[]> {
        const targetClass: Newable<BaseEntity> = metadata.target();
        const targetDriver: ValKeyRepositoryDriver<BaseEntity> = new ValKeyRepositoryDriver(
            targetClass,
            this.client,
            this.keyPrefix,
            this.dataSource
        );
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
            res.push(this.onlySaved(await targetDriver.save([entity], transaction, true)).id);
        }
        return res;
    }

    /**
     * Checks whether saving an entity should also save the entities of the given relation.
     *
     * Mirrors the persistence flag that a sql data source derives from the cascade options of both
     * sides of the relation.
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

    private hasCascadeFlag(cascade: RelationMetadata<BaseEntity>['cascade']): boolean {
        if (cascade === true) {
            return true;
        }
        return Array.isArray(cascade) && cascade.includes('insert');
    }

    private async removeManyToManyRelations(id: string, transaction: ValKeyTransaction | undefined): Promise<void> {
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (metadata.type !== Relation.MANY_TO_MANY) {
                continue;
            }
            const joinKey: string = this.joinKey(id, key);
            const inverseDriver: ValKeyRepositoryDriver<BaseEntity> = new ValKeyRepositoryDriver(
                metadata.target(),
                this.client,
                this.keyPrefix,
                this.dataSource
            );

            // the removed entity must not stay behind in the sets of the entities it was related to
            for (const relatedId of await this.readSet(joinKey, transaction)) {
                await this.write(
                    { type: 'setRemove', key: inverseDriver.joinKey(relatedId, metadata.inverseSide), members: [id] },
                    transaction
                );
            }
            await this.write({ type: 'delete', key: joinKey }, transaction);
        }
    }

    /**
     * Converts the given data into the fields of a valkey hash.
     * @param data - The data to convert.
     * @param isNew - Whether or not the entity is created for the first time, in which case defaults are applied.
     * @returns The hash fields.
     */
    private toFields(data: DeepPartial<T>, isNew: boolean): Record<string, string> {
        const res: Record<string, string> = {};

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
            res[key] = JSON.stringify(this.toStorableValue(value, metadata));
        }
        return res;
    }

    /**
     * Writes the foreign key of a to one relation when the relation was provided as a full entity.
     * @param data - The data that is being saved.
     * @param key - The property key of the relation.
     * @param metadata - The metadata of the relation.
     * @param fields - The hash fields to write the foreign key into.
     */
    private applyToOneRelation(
        data: DeepPartial<T>,
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        fields: Record<string, string>
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
     * What a value is written into its hash field as.
     *
     * A file is the one kind whose way back is named by the property rather than readable from what
     * json held, so it is written as the text {@link ValKeyRepositoryDriver.fromStorableValue} reads
     * it by. Everything else goes through the converter every json value goes through.
     * @param value - The value to write.
     * @param metadata - The property that declares what the value is.
     * @returns What json is given.
     */
    private toStorableValue(value: unknown, metadata: PropertyMetadata): unknown {
        if (metadata.type === 'file' && Buffer.isBuffer(value)) {
            return value.toString('base64');
        }
        return toJsonValue(value);
    }

    private fromFields(row: Record<string, string>): T {
        const res: Record<string, unknown> = {};

        for (const [key, raw] of ObjectUtilities.entries(row)) {
            const metadata: PropertyMetadata | undefined = this.properties[key];
            const parsed: unknown = JSON.parse(raw);
            res[key] = metadata == undefined ? parsed : this.fromStorableValue(parsed, metadata);
        }
        return res as T;
    }

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
                return readNumber(String(value), metadata.format);
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
        // ordering text is the application's answer rather than this driver's, so that a sort done
        // here and a sort done by a database agree - see LocalizeServiceInterface.compareText
        // eslint-disable-next-line typescript/no-base-to-string
        return inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).compareText(String(a), String(b));
    }

    private async generateId(): Promise<string> {
        const primary: [string, PropertyMetadata] | undefined = ObjectUtilities
            .entries(this.properties)
            .find(([, m]) => 'primary' in m && m.primary);

        if (primary?.[1].type === 'number') {
            return (await this.client.incr(`${this.keyPrefix}:${this.tableName}:sequence`)).toString();
        }
        return UUIDUtilities.generate();
    }

    /**
     * Reads the ids that a where filter pins down, so that the rows can be read directly.
     *
     * The returned ids are only candidates: the filter is still evaluated afterwards, which is why a
     * filter may narrow them down further (eg. `{ id: 'a', name: 'b' }`) without being a problem here.
     * As soon as one part of an or filter does not pin the id, every entity has to be looked at.
     * @param where - The where filter of the query.
     * @returns The candidate ids, or undefined when the filter does not pin the id.
     */
    private idsFromFilter(where: DriverFindOptions<T>['where']): string[] | undefined {
        if (where == undefined) {
            return undefined;
        }
        const filters: WhereFilter<T>[] = Array.isArray(where) ? where : [where];
        const res: string[] = [];

        for (const filter of filters) {
            const idFilter: unknown = (filter as Record<string, unknown>)['id'];

            if (typeof idFilter === 'string') {
                res.push(idFilter);
                continue;
            }
            if (idFilter != undefined && typeof idFilter === 'object' && 'oneOf' in idFilter && Array.isArray(idFilter.oneOf)) {
                res.push(...idFilter.oneOf.filter(id => typeof id === 'string'));
                continue;
            }
            return undefined;
        }
        return res;
    }

    /**
     * Resolves the candidate ids of a filter that pins everything a unique declaration names.
     *
     * A miss is deliberately not an answer. The index is a shortcut, and a row written before its
     * declaration existed - or before this index did - carries no entry, so concluding "no such row"
     * from an empty one would hide it. Falling back reads every row, which is what the query would
     * have done anyway.
     * @param where - The where filter of the query.
     * @param transaction - The transaction to read through.
     * @returns The candidate ids, or undefined when the filter names no group or the index has no
     * entry for it.
     */
    private async idsFromUniqueFilter(
        where: DriverFindOptions<T>['where'],
        transaction: ValKeyTransaction | undefined
    ): Promise<string[] | undefined> {
        if (where == undefined || !this.uniqueGroups.length) {
            return undefined;
        }
        const filters: WhereFilter<T>[] = Array.isArray(where) ? where : [where];
        const keys: string[] = [];

        for (const filter of filters) {
            const key: string | undefined = this.uniqueKeyForFilter(filter);
            if (key == undefined) {
                return undefined;
            }
            keys.push(key);
        }

        // read together rather than one after another: the branches of an or are independent, so
        // this costs one round trip instead of one per branch
        const perKey: string[][] = await Promise.all(keys.map(async key => await this.readSet(key, transaction)));
        if (perKey.some(ids => !ids.length)) {
            return undefined;
        }
        return perKey.flat();
    }

    /**
     * Builds the index key of the first unique group a single filter names in full.
     * @param filter - One branch of the where filter.
     * @returns The key, or undefined when no group is pinned by plain values.
     */
    private uniqueKeyForFilter(filter: WhereFilter<T>): string | undefined {
        const conditions: Record<string, unknown> = filter as Record<string, unknown>;

        for (const group of this.uniqueGroups) {
            // a key covering part of the table indexes part of the table: a row it leaves out is
            // deliberately absent, so its index answers "which covered row holds this value" rather
            // than "which rows hold it". Reading a filter through one would hand back the covered
            // row and silently drop every other row holding the same value - a `count` of one where
            // two exist. Only a key over every row can shortcut a filter that does not name its own
            // condition, and the fallback below is a full read, which is always right
            if (!coversEveryRow(group.where)) {
                continue;
            }
            const values: string[] = [];
            for (const key of group.properties) {
                const condition: unknown = conditions[key];
                // only a plain value pins a row. An operator may match several, which is exactly what
                // an index over one value cannot answer
                if (condition == undefined || (typeof condition === 'object' && !(condition instanceof Date))) {
                    break;
                }
                values.push(`${key}=${JSON.stringify(condition)}`);
            }
            if (values.length === group.properties.length) {
                return this.uniqueKey(group.properties, values.join(':'));
            }
        }
        return undefined;
    }

    private async readIds(transaction: ValKeyTransaction | undefined): Promise<string[]> {
        return await this.readSet(this.idsKey(), transaction);
    }

    private async readSet(key: string, transaction: ValKeyTransaction | undefined): Promise<string[]> {
        // eslint-disable-next-line cspell/spellchecker
        const stored: string[] = [...await this.client.smembers(key)].map(m => this.toStringValue(m));
        return transaction ? transaction.resolveSetMembers(key, stored) : stored;
    }

    private async readRow(id: string, transaction: ValKeyTransaction | undefined): Promise<Record<string, string> | undefined> {
        const key: string = this.rowKey(id);
        if (transaction?.isDeleted(key) === true) {
            return undefined;
        }

        // eslint-disable-next-line cspell/spellchecker
        const stored: HashDataType = await this.client.hgetall(key);
        const row: Record<string, string> | undefined = stored.length
            ? Object.fromEntries(stored.map(e => [this.toStringValue(e.field), this.toStringValue(e.value)]))
            : undefined;

        return transaction ? transaction.resolveHash(key, row) : row;
    }

    /**
     * Applies a write, either directly or by buffering it inside the given transaction.
     * @param write - The write to apply.
     * @param transaction - The transaction to buffer the write in, if any.
     */
    private async write(
        write: Parameters<ValKeyTransaction['add']>[0],
        transaction: ValKeyTransaction | undefined
    ): Promise<void> {
        if (transaction) {
            await transaction.add(write);
            return;
        }
        switch (write.type) {
            case 'hashSet': {
                // eslint-disable-next-line cspell/spellchecker
                await this.client.hset(write.key, write.values);
                return;
            }
            case 'hashDelete': {
                // eslint-disable-next-line cspell/spellchecker
                await this.client.hdel(write.key, write.fields);
                return;
            }
            case 'delete': {
                await this.client.del([write.key]);
                return;
            }
            case 'setAdd': {
                // eslint-disable-next-line cspell/spellchecker
                await this.client.sadd(write.key, write.members);
                return;
            }
            case 'setRemove': {
                // eslint-disable-next-line cspell/spellchecker
                await this.client.srem(write.key, write.members);
                return;
            }
        }
    }

    private toValKeyTransaction(transaction: Transaction | undefined): ValKeyTransaction | undefined {
        if (transaction == undefined) {
            return undefined;
        }
        if (!(transaction instanceof ValKeyTransaction)) {
            throw new InternalError('The provided transaction does not belong to a valkey data source.');
        }
        return transaction;
    }

    private isRelation(metadata: PropertyMetadata | undefined): metadata is RelationMetadata<BaseEntity> {
        return metadata?.type === Relation.HAS_ONE
            || metadata?.type === Relation.BELONGS_TO_ONE
            || metadata?.type === Relation.MANY_TO_ONE
            || metadata?.type === Relation.ONE_TO_MANY
            || metadata?.type === Relation.MANY_TO_MANY;
    }

    private resolveJoinColumn(metadata: RelationMetadata<BaseEntity>, key: string): string {
        if (
            (metadata.type === Relation.MANY_TO_ONE || metadata.type === Relation.BELONGS_TO_ONE)
            && metadata.joinColumn != undefined
        ) {
            return metadata.joinColumn;
        }
        throw new InternalError(`The relation "${this.entityClass.name}.${key}" needs to have "joinColumn" set.`);
    }

    private toStringValue(value: GlideString): string {
        return typeof value === 'string' ? value : Buffer.from(value).toString('utf8');
    }

    private rowKey(id: string): string {
        return `${this.keyPrefix}:${this.tableName}:${id}`;
    }

    private idsKey(): string {
        return `${this.keyPrefix}:${this.tableName}:ids`;
    }

    private joinKey(id: string, propertyKey: string): string {
        return `${this.keyPrefix}:${this.tableName}:${id}:${propertyKey}`;
    }

    private uniqueKey(group: string[], values: string): string {
        return `${this.keyPrefix}:${this.tableName}:unique:${group.join(',')}:${values}`;
    }

    private onlySaved<R>(rows: R[]): R {
        const row: R | undefined = rows[0];
        if (row == undefined) {
            throw new InternalError('Saving one entity returned no row.');
        }
        return row;
    }
}