import { createHash } from 'node:crypto';

import type { Batch, GlideClient, GlideReturnType, GlideString, Script } from '@valkey/valkey-glide';

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
import { parseNumber } from '../../parsing/functions/parse-number.function';
import { parseObject } from '../../parsing/functions/parse-object.function';
import { parseOneOf } from '../../parsing/functions/parse-one-of.function';
import { toJsonValue } from '../../parsing/functions/to-json-value.function';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { scanValKeyKeys } from '../data-sources/val-key/scan-val-key-keys.function';
import { type ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { valKeyGlide } from '../data-sources/val-key/val-key-glide.function';
import { WhereFilterEvaluator } from '../data-sources/where-converter/where-filter.evaluator';
import { UpsertRow } from '../models/upsert-row.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { applyGuardedValKeyWrites } from '../transaction/apply-guarded-val-key-writes.function';
import { KeyDeclarationsChangedError } from '../transaction/key-declarations-changed.error';
import { queueValKeyWrite } from '../transaction/queue-val-key-write.function';
import { Transaction } from '../transaction/transaction.model';
import { ValKeyBufferedWrite, ValKeyTransaction } from '../transaction/val-key-transaction.model';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';
import { UpsertIdentityUtilities } from '../upsert-identity.utilities';

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
 * One row of an upsert, with what is read off it before anything is looked up.
 */
type PendingUpsert<T extends BaseEntity> = {
    /**
     * The row to insert when its identity is free.
     */
    create: DeepPartial<T>,
    /**
     * The changes to apply when its identity is held.
     */
    changes: [string, UpsertChange][],
    /**
     * The filter naming the row that holds its identity.
     */
    conflictWhere: Where<T>
};

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
    existing: Record<string, string> | undefined
};

/**
 * One row as it was stored before a write, and as it is stored after it.
 */
export type StoredRowChange = {
    /**
     * The id of the row.
     */
    id: string,
    /**
     * The row before the write, json encoded field by field. Undefined for a row the write created.
     */
    before: Record<string, string> | undefined,
    /**
     * The row after the write. Undefined for a row the write deleted.
     */
    after: Record<string, string> | undefined
};

/**
 * The index declaration a filter is answered from, and the entries of it the filter names.
 */
type IndexLookup = {
    /**
     * The properties of the declaration.
     */
    group: string[],
    /**
     * The keys of the entries holding the ids of the rows the filter can match.
     */
    keys: string[]
};

/**
 * The indexes and uniques an entity's rows are kept under, as one list.
 */
type KeyLists = {
    /**
     * The unique declarations, each with its properties sorted.
     */
    uniques: UniqueGroup[],
    /**
     * The index declarations, each sorted.
     */
    indexes: string[][]
};

/**
 * The indexes and uniques the store keeps for an entity, as the store lists them.
 */
type StoredKeys = KeyLists & {
    /**
     * The list as it is stored, which every write derived from it is applied against. An empty string
     * when nothing is listed.
     */
    stored: string
};

/**
 * One index or unique declaration, as the reconciliation compares and builds them.
 */
type KeyDeclaration = {
    /**
     * What the declaration is told apart by, and named by in the set of the ones that are built.
     */
    identity: string,
    /**
     * What every key holding one of its entries starts with.
     */
    keyPrefix: string,
    /**
     * The properties, sorted.
     */
    properties: string[],
    /**
     * The unique declaration, when it is one rather than an index.
     */
    unique: UniqueGroup | undefined
};

/**
 * One entry a row holds under a declaration being built.
 */
type BuiltEntry = {
    /**
     * The key of the entry.
     */
    key: string,
    /**
     * Whether the entry belongs to a unique, which no other row may hold.
     */
    unique: boolean
};

/**
 * How often a write that finds the list of indexes and uniques changed under it starts over before it
 * gives up. The list changes once per deploy at most, so a second attempt already has the new one.
 */
const KEY_CHANGE_ATTEMPTS: number = 3;

/**
 * The script building entries, once it has been built - on first use, for the reason the scripts of
 * the data source are.
 */
let buildEntriesScript: Script | undefined;

/**
 * Adds rows to the entries of the declarations being built, each only while it still holds exactly
 * what it was read with: a row written in between is one whose writer already keeps it under them,
 * and an entry made from the old read would name a value it no longer holds.
 *
 * Answers every entry of a unique that another row already holds, as the entry, that row and this one
 * in turn.
 * @returns The script.
 */
function resolveBuildEntriesScript(): Script {
    buildEntriesScript ??= new (valKeyGlide().Script)(
        'local conflicts = {} '
        + 'for _, row in ipairs(cjson.decode(ARGV[1])) do '
        // eslint-disable-next-line cspell/spellchecker
        + 'local current = redis.call("hgetall", row[1]) '
        + 'local same = #current == #row[3] '
        + 'if same then '
        + 'local expected = {} '
        + 'for i = 1, #row[3], 2 do expected[row[3][i]] = row[3][i + 1] end '
        + 'for i = 1, #current, 2 do if expected[current[i]] ~= current[i + 1] then same = false break end end '
        + 'end '
        + 'if same then for _, entry in ipairs(row[4]) do '
        // eslint-disable-next-line cspell/spellchecker
        + 'if entry[2] then for _, holder in ipairs(redis.call("smembers", entry[1])) do '
        + 'if holder ~= row[2] then '
        + 'table.insert(conflicts, entry[1]) table.insert(conflicts, holder) table.insert(conflicts, row[2]) '
        + 'end '
        + 'end end '
        // eslint-disable-next-line cspell/spellchecker
        + 'redis.call("sadd", entry[1], row[2]) '
        + 'end end '
        + 'end return conflicts'
    );
    return buildEntriesScript;
}

/**
 * Whether a value is a list of names, which is what a declaration's properties are.
 * @param value - The value.
 * @returns True when it is.
 */
function isTextList(value: unknown): value is string[] {
    return Array.isArray(value) && value.every((entry: unknown) => typeof entry === 'string');
}

/**
 * Whether a value read back from the store is a unique declaration as it is listed there.
 * @param value - The value.
 * @returns True when it is.
 */
function isListedUnique(value: unknown): value is UniqueGroup {
    return typeof value === 'object'
        && value != undefined
        && 'properties' in value
        && isTextList(value.properties)
        && (!('where' in value) || value.where == undefined || typeof value.where === 'object');
}

/**
 * Whether a value read back from the store is the list of indexes and uniques it keeps.
 * @param value - The value.
 * @returns True when it is.
 */
function isKeyLists(value: unknown): value is KeyLists {
    return typeof value === 'object'
        && value != undefined
        && 'uniques' in value
        && Array.isArray(value.uniques)
        && value.uniques.every((unique: unknown) => isListedUnique(unique))
        && 'indexes' in value
        && Array.isArray(value.indexes)
        && value.indexes.every((index: unknown) => isTextList(index));
}

/**
 * What one row does to one unique declaration's index.
 */
type UniqueIndexChange = {
    /**
     * The id of the row.
     */
    id: string,
    /**
     * The declaration.
     */
    group: UniqueGroup,
    /**
     * The values the row gives up, encoded the way the index stores them.
     */
    previous: string | undefined,
    /**
     * The values the row takes up, encoded the way the index stores them.
     */
    next: string | undefined
};

/**
 * Rows read together that ask for the same relations, so those are resolved for all of them at once.
 */
type RowsAskingAlike<T extends BaseEntity> = {
    /**
     * The relations they ask for.
     */
    relations: RelationTree,
    /**
     * The rows.
     */
    entities: T[]
};

/**
 * How many reads one pipeline carries.
 *
 * Bounded rather than all of them in one, because a pipeline's replies are held until the last one
 * arrives and a read is as large as its caller made it.
 */
const READS_PER_PIPELINE: number = 1000;

/**
 * How many writes one pipeline carries, for writes that go out without a transaction. Bounded for
 * the reason reads are: a pipeline is held whole until it is answered.
 */
const WRITES_PER_PIPELINE: number = 1000;

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
 * gets an index under `{prefix}:{tableName}:unique:{properties}:{values}`, holding the id of the row
 * that carries those values. A unique over some of the rows has a short hash of its filter after its
 * properties, so that two over the same properties keep apart. Anything declared indexed gets
 * `{prefix}:{tableName}:index:{properties}:{values}`, holding the ids of every row carrying them.
 *
 * ## Which indexes and uniques are kept
 * The ones listed under `{prefix}:{tableName}:keys`, which booting brings in line with what the entity
 * declares, rather than the ones this version of the entity declares. Every write reads the list along
 * with the rows it reads anyway, keeps what it names, and is applied only while the list is still the
 * one it read. So an instance of an older version, still serving while a newer one starts, keeps what
 * the newer one declares. A declaration is read from once `{prefix}:{tableName}:built` names it, which
 * booting does once it has indexed every row stored before the declaration.
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
 * Three filters avoid loading everything: one that pins the id, one that pins everything a unique
 * declaration names, and one that names everything an index declaration does once it is built. The
 * second is a shortcut rather than an authority - a miss falls back to reading every row, because a
 * row stored before its index existed has no entry and must not be reported as absent.
 */
export class ValKeyRepositoryDriver<T extends BaseEntity> implements RepositoryDriverInterface<T> {

    private readonly evaluator: WhereFilterEvaluator = new WhereFilterEvaluator();

    private readonly properties: Record<string, PropertyMetadata>;

    private readonly tableName: string;

    /**
     * Every set of properties this version of the entity declares to name at most one row, each in a
     * stable order.
     *
     * Both ways of declaring it end up here, so neither has to be repeated: a property carrying
     * `unique` is a group of one, and a group in the entity's `uniques` is the multi property form.
     * What a filter may be answered by; what a write keeps is the list the store holds.
     */
    private readonly uniqueGroups: UniqueGroup[];

    /**
     * Every set of properties this version of the entity declares an index over, each in a stable
     * order.
     *
     * Read from only once booting has indexed the rows stored before it - see
     * {@link ValKeyRepositoryDriver.reconcileStoredKeys}. A group naming an encrypted or hashed
     * property is left out: what is stored for one is never the value a filter names.
     */
    private readonly indexGroups: string[][];

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
        this.indexGroups = this.resolveIndexGroups(ModelRegistry.get(this.entityClass).keyDescriptor.indexes);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        // a relation given an empty list saves its children with nothing, and nothing has no write -
        // adding to the id set in particular is refused without a member
        if (!data.length) {
            return [];
        }
        // a unique declaration is only enforceable while nobody else can be writing the same value,
        // and what holds a key against everybody else is a grant, which lives on a transaction. A
        // save that was given one has somewhere to keep that grant already; a save that was not takes
        // a transaction of its own - but only when there is something to enforce, so an entity
        // without one keeps writing directly. What this version declares decides it up front, and the
        // save switches to a transaction once it has read that the store keeps a unique all the same
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

        // held before the stored rows are read rather than as each is written: what a row holds
        // decides which unique values it gives up, and reading it before that would let another writer
        // change it in between. One claim for every row, rather than one per write
        await valKeyTransaction?.claimKeys(ids.map(id => this.rowKey(id)));
        // with the list of what the store keeps, in the same round trip
        const [existingRows, keys]: [Map<string, Record<string, string>>, StoredKeys] = await this.readRowsAndKeys(ids, valKeyTransaction);
        if (valKeyTransaction == undefined && keys.uniques.length) {
            // this version declares nothing unique, and the store enforces something all the same -
            // what a newer version declares. Saved the way that version saves, holding the rows first
            return await this.inTransaction(undefined, async own => await this.saveThrough(data, own, reload));
        }

        // the entries are independent once they have their ids: each writes its own row key and its
        // own join keys, and the single key they share - the id set - only ever has members added. So
        // every write of every row goes out together, in one request when there is no transaction.
        // Writing them one row at a time cost two requests a row on an entity declaring nothing unique,
        // which skips the transaction because there is nothing to hold - the reason for skipping it
        // was never to write per row
        const writes: ValKeyBufferedWrite[] = [];
        const fieldsById: Map<string, Record<string, string>> = new Map();
        for (const [entry, id] of entriesWithIds) {
            const fields: Record<string, string> = this.toFields(entry, !existingRows.has(id));
            fieldsById.set(id, fields);
            writes.push({ type: 'hashSet', key: this.rowKey(id), values: { ...fields, id: JsonUtilities.stringify(id) } });
        }
        writes.push({ type: 'setAdd', key: this.idsKey(), members: ids });
        // the rows of a one to many or has one relation are the repository's to write, through the
        // repository of their own entity
        writes.push(...await this.resolveManyToManyWrites(entriesWithIds, valKeyTransaction));

        const written: WrittenRow[] = ids.map(id => ({
            id,
            fields: fieldsById.get(id) ?? {},
            existing: existingRows.get(id)
        }));
        // an update carries only some properties, so what a row ends up holding is the stored row
        // with the write applied over it
        const changes: StoredRowChange[] = written.map(w => ({ id: w.id, before: w.existing, after: { ...w.existing, ...w.fields } }));
        await this.saveWithKeys(writes, changes, keys, valKeyTransaction);

        if (!reload) {
            return [];
        }
        // with the relations each row's data wrote, as they were stored, so a caller gets the ids of
        // the rows it references
        const relationsById: Map<string, RelationTree> = new Map(
            entriesWithIds.map(([entry, id]) => [id, this.providedKeyRelations(entry)])
        );
        return await this.findByIds(ids, { transaction: valKeyTransaction }, valKeyTransaction, relationsById);
    }

    /**
     * Applies the writes of a save together with what they change in the indexes and uniques the
     * store keeps.
     *
     * The index entries go with the rows rather than after them: an entry is a set operation, which
     * commutes with every other writer's and so needs neither a grant nor an order. The uniques are
     * claimed and checked after every row is written, as one step for all of them, and a violation
     * leaves nothing behind - they are only ever kept inside a transaction, and everything is
     * buffered in it until it commits.
     * @param writes - The writes of the rows and their relations.
     * @param changes - The rows as they were stored and as they are stored now.
     * @param keys - The indexes and uniques the store keeps, as the save read them.
     * @param transaction - The transaction to write through, when there is one.
     * @throws When another row already holds the values one of the uniques names.
     * @throws KeyDeclarationsChangedError when the list kept changing under a save without a transaction.
     */
    private async saveWithKeys(
        writes: ValKeyBufferedWrite[],
        changes: StoredRowChange[],
        keys: StoredKeys,
        transaction: ValKeyTransaction | undefined
    ): Promise<void> {
        if (transaction) {
            transaction.guardKey(this.keysKey(), keys.stored);
            await this.writeAll([...writes, ...this.resolveIndexWrites(changes, keys.indexes)], transaction);
            await this.saveUniqueIndexes(changes, keys.uniques, transaction);
            return;
        }
        let current: StoredKeys = keys;
        for (let attempt: number = 1; attempt <= KEY_CHANGE_ATTEMPTS; attempt++) {
            if (current.uniques.length) {
                // a newer version started keeping a unique meanwhile, which only a transaction can
                await this.inTransaction(undefined, async own => {
                    await this.saveWithKeys(writes, changes, await this.readStoredKeys(), own);
                });
                return;
            }
            if (await this.writeGuarded([...writes, ...this.resolveIndexWrites(changes, current.indexes)], current)) {
                return;
            }
            current = await this.readStoredKeys();
        }
        throw new KeyDeclarationsChangedError();
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
        // a filter that pins the id, everything a unique declaration names, or everything a complete
        // index names, can read the rows directly instead of going through every entity
        const ids: string[] = this.idsFromFilter(options.where)
            ?? await this.idsFromUniqueFilter(options.where, valKeyTransaction)
            ?? await this.idsFromIndexFilter(options.where, valKeyTransaction)
            ?? await this.readIds(valKeyTransaction);
        // only what the filter and the order cannot be answered without is read for every row; the
        // rest waits for the rows that are handed back. Reading every relation of every row first
        // read the relations of the whole table for a filter that named none of them
        const resolved: RelationTree = this.relationsToResolve(options);
        const forReading: Set<string> = new Set(this.relationsForReading(options).keys());
        const entities: T[] = await this.findByIds(
            ids,
            { ...options, relations: new Map([...resolved].filter(([key]) => forReading.has(key))) },
            valKeyTransaction
        );

        const filtered: T[] = options.where
            ? entities.filter(e => this.evaluator.matches(e, options.where as Where<T>, this.entityClass))
            : entities;
        const ordered: T[] = this.applyOrder(filtered, options.order);

        const skip: number = options.skip ?? 0;
        const window: T[] = options.take == undefined ? ordered.slice(skip) : ordered.slice(skip, skip + options.take);
        await this.resolveRelationsOf(window, new Map([...resolved].filter(([key]) => !forReading.has(key))), valKeyTransaction);
        // after the window rather than before it, so that nothing is taken off a row that is about to
        // be thrown away
        EntityRelationsUtilities.keepOnlyRequested(window, resolved, EntityRelationsUtilities.resolveTree(options.relations));
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
            ?? await this.idsFromIndexFilter(options.where, valKeyTransaction)
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
        // the rows alone rather than the whole entity, which would serialize filter writes that match
        // nothing in common. The claim takes them in sorted order, so two of these overlapping take
        // the rows they share in the same order rather than in opposite ones
        await valKeyTransaction.claimKeys(ids.map(id => this.rowKey(id)));
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
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined
    ): Promise<T[]> {
        const pending: PendingUpsert<T>[] = rows.map(row => ({
            create: row.create,
            changes: ObjectUtilities
                .entries(row.onConflict as Record<string, UpsertChange | undefined>)
                .filter((entry): entry is [string, UpsertChange] => entry[1] != undefined),
            // the rows an identity may land on are the ones the key covers, which is not every row
            // holding the identity's values: a key over part of a table leaves the rest free
            conflictWhere: UpsertIdentityUtilities.resolveConflictWhere(this.entityClass, identity, row.create)
        }));
        if (pending.some(p => !p.changes.length)) {
            throw new InternalError('upsert was called with an empty onConflict, so the conflict path would do nothing.');
        }

        return await this.inTransaction(transaction, async valKeyTransaction => {
            // before the read, which is the whole of what makes this atomic. Valkey has no statement
            // that resolves a row by anything other than its key, so the row has to be looked for -
            // and a grant taken after that look would leave the value it found already stale. In
            // sorted order, which the claim keeps, for the reason `claimRows` needs it: two of these
            // overlapping take what they share in the same order rather than in opposite ones
            await valKeyTransaction.claimKeys(pending.map(p => this.upsertKey(identity, p.create)));

            // one read for every identity, through the key's index where it answers for all of them.
            // Each row is then paired with the rows holding its own values and judged by its own
            // filter alone: judging every row read against the filter of every identity, as one
            // filter of all of them, was the square of the batch
            const branches: WhereFilter<T>[] = pending.flatMap(p => Array.isArray(p.conflictWhere) ? p.conflictWhere : [p.conflictWhere]);
            const candidateIds: string[] = await this.idsFromUniqueFilter(branches, valKeyTransaction)
                ?? await this.readIds(valKeyTransaction);
            const candidates: Map<string, T[]> = new Map();
            for (const candidate of await this.findByIds(candidateIds, { transaction: valKeyTransaction }, valKeyTransaction)) {
                const values: string = UpsertIdentityUtilities.resolveValues(identity, candidate);
                candidates.set(values, [...candidates.get(values) ?? [], candidate]);
            }
            const foundIds: Map<PendingUpsert<T>, string> = new Map();
            for (const p of pending) {
                const holder: T | undefined = candidates.get(UpsertIdentityUtilities.resolveValues(identity, p.create))
                    ?.find(c => this.evaluator.matches(c, p.conflictWhere, this.entityClass));
                if (holder != undefined) {
                    foundIds.set(p, holder.id);
                }
            }

            // the rows are only identified by the read above, so their own grants can only be taken
            // after it - and a plain write may have been holding one, and committing, the whole time
            // the read was happening. Reading again once they are held is what makes the value this
            // adds to the value that is actually stored, rather than the one that was stored a moment
            // ago. With whatever relations `reachable` needs, so each row can be judged by it right
            // here rather than read a second time through a filter
            await this.claimRows([...foundIds.values()], valKeyTransaction);
            const held: Map<string, T> = new Map(
                (await this.findByIds([...foundIds.values()], { where: reachable }, valKeyTransaction)).map(e => [e.id, e])
            );

            const data: DeepPartial<T>[] = pending.map(p => {
                const id: string | undefined = foundIds.get(p);
                const existing: T | undefined = id == undefined ? undefined : held.get(id);
                if (existing == undefined) {
                    return p.create;
                }
                // judged while the row's grant is held, so what decides it is what the write lands on
                if (reachable != undefined && !this.evaluator.matches(existing, reachable, this.entityClass)) {
                    const group: UniqueGroup = UpsertIdentityUtilities.resolveUniqueGroup(this.entityClass, identity);
                    throw new UniqueConstraintViolationError(this.entityClass.name, group.properties);
                }
                const updated: Record<string, unknown> = { id: existing.id };
                for (const [key, change] of p.changes) {
                    updated[key] = 'increment' in change
                        ? Number((existing as Record<string, unknown>)[key]) + change.increment
                        : change.set;
                }
                return updated as DeepPartial<T>;
            });
            // one save for every row, which hands them back in the order they were given
            return await this.save(data, valKeyTransaction, true);
        });
    }

    /**
     * Runs the given work inside a valkey transaction, taking one out when the caller passed none.
     *
     * An upsert is only atomic for as long as its grant is held, and a grant is handed back when the
     * transaction that took it ends. Without a transaction of its own there would be nothing to end,
     * so an upsert outside one would hold its grant until it lapsed.
     *
     * A transaction of its own that finds the indexes and uniques changed when it commits is started
     * over: nothing of it was applied, and the work reads them again.
     * @param transaction - The transaction the caller provided, if any.
     * @param fn - The work to run.
     * @returns Whatever the work returned.
     * @throws KeyDeclarationsChangedError when they kept changing.
     */
    private async inTransaction<R>(
        transaction: Transaction | undefined,
        fn: (valKeyTransaction: ValKeyTransaction) => Promise<R>
    ): Promise<R> {
        const provided: ValKeyTransaction | undefined = this.toValKeyTransaction(transaction);
        if (provided) {
            return await fn(provided);
        }

        for (let attempt: number = 1; attempt <= KEY_CHANGE_ATTEMPTS; attempt++) {
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
                if (!(error instanceof KeyDeclarationsChangedError)) {
                    throw error;
                }
            }
        }
        throw new KeyDeclarationsChangedError();
    }

    /**
     * Builds the key that upserts of the same identity contend for.
     *
     * Derived from the identity rather than from a row, because the row may not exist yet - two
     * instances inserting the same identity at the same time are exactly the case this covers, and
     * neither of them has a row key to name. Sorted, so the order the caller wrote the identity in
     * does not change which key it lands on.
     * @param identity - The properties identifying the row.
     * @param row - The row being upserted, holding the values of those properties.
     * @returns The key to hold for the upsert.
     */
    private upsertKey(identity: string[], row: DeepPartial<T>): string {
        const group: UniqueGroup = UpsertIdentityUtilities.resolveUniqueGroup(this.entityClass, identity);
        const values: string = [...group.properties]
            .sort()
            .map(key => `${key}=${JsonUtilities.stringify((row as Record<string, unknown>)[key])}`)
            .join(':');
        return `${this.keyPrefix}:${this.tableName}:upsert:${values}`;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async remove(entities: T[], transaction: Transaction | undefined): Promise<T[]> {
        if (!entities.length) {
            return [];
        }
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(transaction);
        const ids: string[] = entities.map(e => e.id);
        // one claim for every row, rather than one per delete
        await valKeyTransaction?.claimKeys(ids.map(id => this.rowKey(id)));

        // the values a row gives up in its indexes are read off the row as it is stored, not off the
        // entity handed in: that one was read and decrypted for the delete hook, and an encrypted
        // value never encrypts to the same text twice, so encoding it again names no entry that exists.
        // Read for every entity, since which indexes and uniques there are is the store's to say
        const [stored, keys]: [Map<string, Record<string, string>>, StoredKeys] = await this.readRowsAndKeys(ids, valKeyTransaction);

        // every write of every row in one go: nothing has to happen in order, since each row knows its
        // own id and the one key they share - the id set - only ever has members removed from it
        const writes: ValKeyBufferedWrite[] = await this.resolveManyToManyRemovals(ids, valKeyTransaction);
        writes.push(...ids.map((id): ValKeyBufferedWrite => ({ type: 'delete', key: this.rowKey(id) })));
        writes.push({ type: 'setRemove', key: this.idsKey(), members: ids });
        // giving a value up needs nothing held, so this never needs a transaction of its own
        const withKeys: (current: StoredKeys) => ValKeyBufferedWrite[] = current => [
            ...writes,
            ...ids.flatMap(id => this.resolveUniqueIndexRemovals(id, stored.get(id), current.uniques)),
            ...this.resolveIndexWrites(ids.map(id => ({ id, before: stored.get(id), after: undefined })), current.indexes)
        ];

        if (valKeyTransaction) {
            valKeyTransaction.guardKey(this.keysKey(), keys.stored);
            await this.writeAll(withKeys(keys), valKeyTransaction);
            return entities;
        }
        let current: StoredKeys = keys;
        for (let attempt: number = 1; attempt <= KEY_CHANGE_ATTEMPTS; attempt++) {
            if (await this.writeGuarded(withKeys(current), current)) {
                return entities;
            }
            current = await this.readStoredKeys();
        }
        throw new KeyDeclarationsChangedError();
    }

    /**
     * Points every unique declaration the written rows satisfy at them, and stops pointing the values
     * they no longer have.
     *
     * Giving a value up is written as a plain set operation, for the reason the id set is: removals
     * commute, so two rows letting go of different values never have to be ordered against each other
     * and neither has to take a grant. Taking one up does not commute - that is the whole of what
     * unique means - so it is claimed and checked first.
     *
     * Every row stored before a unique was kept is indexed under it by the boot that starts keeping
     * it, before anything reads it.
     * @param rows - The rows as they were stored and as they are stored now. Their fields are taken
     * rather than recomputed, so that a default filled in for a new row is indexed under the value that
     * was actually stored.
     * @param uniques - The uniques the store keeps.
     * @param transaction - The transaction to write through. Always present when there is anything
     * to index, because a save takes a transaction of its own whenever the store keeps a unique.
     * @throws When another row already holds the values one of the declarations names.
     */
    private async saveUniqueIndexes(
        rows: StoredRowChange[],
        uniques: UniqueGroup[],
        transaction: ValKeyTransaction | undefined
    ): Promise<void> {
        const changes: UniqueIndexChange[] = this.resolveUniqueIndexChanges(rows, uniques);

        // the grants before the read, for the reason an upsert's come first: an index cannot say who
        // holds a value until it has been read, and a grant taken afterwards would leave that answer
        // already stale. Holding them until the transaction ends is what makes the check and the
        // write following it one step as far as every other writer is concerned - two instances
        // inserting the same value at the same time is exactly the case this covers, and neither of
        // them has a row to hold instead. All of them in one claim and one read
        const takenKeys: string[] = [...new Set(changes.flatMap(c => c.next == undefined ? [] : [this.uniqueKey(c.group, c.next)]))];
        await transaction?.claimKeys(takenKeys);
        // as stored, without this transaction's writes: those are laid over it change by change below
        const holders: string[][] = await this.readSets(takenKeys, undefined);
        const storedHolders: Map<string, string[]> = new Map(takenKeys.map((key, i) => [key, holders[i] ?? []]));

        // one change at a time, in memory. A unique index key is the second key the rows of one save
        // share, and unlike the id set it is the one whose entire point is that at most one row may
        // hold a value - so a check has to see what the rows before it in this same save have taken,
        // which the transaction's overlay holds by then. Checked all at once, a batch carrying one
        // value twice passed every check and stored both
        for (const { id, group, previous, next } of changes) {
            if (previous != undefined) {
                await this.write({ type: 'setRemove', key: this.uniqueKey(group, previous), members: [id] }, transaction);
            }
            if (next == undefined) {
                continue;
            }
            const key: string = this.uniqueKey(group, next);
            const stored: string[] = storedHolders.get(key) ?? [];
            // the row's own id is not a conflict - a row is never a duplicate of itself - so this asks
            // whether anybody *else* is there rather than whether anything is
            const holder: string | undefined = (transaction ? transaction.resolveSetMembers(key, stored) : stored).find(h => h !== id);
            if (holder != undefined) {
                throw new UniqueConstraintViolationError(this.entityClass.name, group.properties);
            }
            await this.write({ type: 'setAdd', key, members: [id] }, transaction);
        }
    }

    /**
     * Keeps every index and unique the store keeps true to rows that were rewritten without going
     * through a save, as a migration rewrites them. Uniques are enforced on the way, as a save
     * enforces them.
     * @param rows - The rows as they were stored and as they are stored now.
     * @param transaction - The transaction of the migration.
     * @throws When a rewritten row takes up values another row already holds under a unique declaration.
     */
    async saveIndexesOfRewrittenRows(rows: StoredRowChange[], transaction: Transaction): Promise<void> {
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(transaction);
        if (!valKeyTransaction) {
            throw new InternalError('Rows a migration rewrote are indexed in the migration\'s transaction.');
        }
        const keys: StoredKeys = await this.readStoredKeys();
        valKeyTransaction.guardKey(this.keysKey(), keys.stored);
        await this.writeAll(this.resolveIndexWrites(rows, keys.indexes), valKeyTransaction);
        await this.saveUniqueIndexes(rows, keys.uniques, valKeyTransaction);
    }

    /**
     * Moves the entities stored under another table name to the one this entity declares, for a
     * migration renaming it.
     * @param currentTableName - The table name the entities are stored under now.
     * @param transaction - The transaction of the migration.
     * @throws When entities are stored under this entity's table name already.
     */
    async moveStoredKeysFrom(currentTableName: string, transaction: Transaction): Promise<void> {
        if ((await this.readIds(this.toValKeyTransaction(transaction))).length) {
            throw new InternalError(
                `Cannot rename ${currentTableName} to ${this.tableName}, because something is stored under ${this.tableName} already.`
            );
        }
        // into an entity storing nothing, which is what renaming is
        await this.mergeStoredKeysFrom(currentTableName, transaction);
    }

    /**
     * Moves the entities stored under another table name to this entity, next to the ones it stores,
     * for a migration merging them.
     *
     * The rows, their ids and their many to many relations move, and the numbers handed out for new
     * ids go on from at least where they were. A row holding what a stored row holds under its id or
     * under a unique the entity declares is left out, and no other row keeps a relation to it. The
     * keys of indexes and uniques are deleted instead, and booting builds them again over the rows.
     * @param currentTableName - The table name the entities to merge are stored under.
     * @param transaction - The transaction of the migration.
     */
    async mergeStoredKeysFrom(currentTableName: string, transaction: Transaction): Promise<void> {
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(transaction);
        if (!valKeyTransaction) {
            throw new InternalError('Entities are moved in the migration\'s transaction.');
        }
        const prefix: string = `${this.keyPrefix}:${this.tableName}:`;
        const currentPrefix: string = `${this.keyPrefix}:${currentTableName}:`;
        const toCurrentKey: (key: string) => string = key => `${currentPrefix}${key.slice(prefix.length)}`;

        const [ids = []]: string[][] = await this.readSets([toCurrentKey(this.idsKey())], valKeyTransaction);
        const moved: Map<string, Record<string, string>> = await this.resolveMovedRows(ids, toCurrentKey, valKeyTransaction);
        const writes: ValKeyBufferedWrite[] = [];
        const deleted: Set<string> = new Set([
            ...await scanValKeyKeys(this.client, `${currentPrefix}*`),
            // with the ones only the transaction holds so far, which no scan finds
            toCurrentKey(this.idsKey()),
            ...ids.map(id => toCurrentKey(this.rowKey(id))),
            // the indexes and uniques of this name, which do not cover the rows merged in
            ...await scanValKeyKeys(this.client, `${prefix}unique:*`),
            ...await scanValKeyKeys(this.client, `${prefix}index:*`),
            this.keysKey(),
            this.builtKey()
        ]);
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (metadata.type !== Relation.MANY_TO_MANY) {
                continue;
            }
            const currentJoinKeys: string[] = ids.map(id => toCurrentKey(this.joinKey(id, key)));
            const related: string[][] = await this.readSets(currentJoinKeys, valKeyTransaction);
            for (const joinKey of currentJoinKeys) {
                deleted.add(joinKey);
            }
            writes.push(...this.resolveMovedRelationWrites(
                key,
                metadata.target(),
                metadata.inverseSide,
                ids.map((id, i): [string, string[]] => [id, related[i] ?? []]),
                moved
            ));
        }
        const sequenceKey: string = `${prefix}sequence`;
        const currentSequenceKey: string = toCurrentKey(sequenceKey);
        deleted.delete(sequenceKey);
        deleted.delete(currentSequenceKey);

        // the deletes first, so that what is written after them is what the keys hold
        await this.writeAll(
            [
                ...[...deleted].map((key): ValKeyBufferedWrite => ({ type: 'delete', key })),
                ...[...moved].map(([id, values]): ValKeyBufferedWrite => ({ type: 'hashSet', key: this.rowKey(id), values })),
                ...moved.size ? [{ type: 'setAdd', key: this.idsKey(), members: [...moved.keys()] } satisfies ValKeyBufferedWrite] : [],
                ...writes
            ],
            valKeyTransaction
        );
        await this.carrySequence(currentSequenceKey, sequenceKey);
    }

    /**
     * Reads the rows a merge moves: every one but those holding what a stored row holds under its id
     * or under a unique the entity declares.
     * @param ids - The ids of the rows to merge.
     * @param toCurrentKey - Turns a key of this entity into the one the rows to merge are kept under.
     * @param transaction - The transaction of the migration.
     * @returns The rows that move, by their id.
     */
    private async resolveMovedRows(
        ids: string[],
        toCurrentKey: (key: string) => string,
        transaction: ValKeyTransaction
    ): Promise<Map<string, Record<string, string>>> {
        const storedIds: string[] = await this.readIds(transaction);
        const taken: Set<string> = new Set(storedIds.map(id => `id=${id}`));
        for (const fields of (await this.readRows(storedIds, transaction)).values()) {
            for (const value of this.resolveTakenValues(fields)) {
                taken.add(value);
            }
        }

        const rowReplies: GlideReturnType[] = await this.readPipelined(
            ids.map(id => toCurrentKey(this.rowKey(id))),
            // eslint-disable-next-line cspell/spellchecker
            (batch, key) => batch.hgetall(key)
        );
        const res: Map<string, Record<string, string>> = new Map();
        for (const [i, id] of ids.entries()) {
            const row: Record<string, string> | undefined = transaction.resolveHash(
                toCurrentKey(this.rowKey(id)),
                this.toRow(rowReplies[i])
            );
            if (row != undefined && !taken.has(`id=${id}`) && !this.resolveTakenValues(row).some(value => taken.has(value))) {
                res.set(id, row);
            }
        }
        return res;
    }

    /**
     * Works out the writes that move one many to many relation of the rows a merge moves.
     * @param key - The property of the relation.
     * @param target - The entity on the other side.
     * @param inverseSide - The property of the relation on the other side.
     * @param related - The ids of the rows to merge, each with the ids it relates to.
     * @param moved - The rows that move, by their id.
     * @returns The writes.
     */
    private resolveMovedRelationWrites(
        key: string,
        target: Newable<BaseEntity>,
        inverseSide: string,
        related: [string, string[]][],
        moved: Map<string, Record<string, string>>
    ): ValKeyBufferedWrite[] {
        const res: ValKeyBufferedWrite[] = [];
        // the other side are this entity's own sets then, which move with the rows - without the rows
        // left out
        if (target === this.entityClass) {
            for (const [id, members] of related.filter(([id]) => moved.has(id))) {
                const kept: string[] = members.filter(m => moved.has(m));
                if (kept.length) {
                    res.push({ type: 'setAdd', key: this.joinKey(id, key), members: kept });
                }
            }
            return res;
        }
        const inverseDriver: ValKeyRepositoryDriver<BaseEntity> = new ValKeyRepositoryDriver(
            target,
            this.client,
            this.keyPrefix,
            this.dataSource
        );
        for (const [id, members] of related) {
            if (moved.has(id) && members.length) {
                res.push({ type: 'setAdd', key: this.joinKey(id, key), members });
            }
            // the other side: a moved row under the name it gives the relation now, which for rows
            // merged from another entity is not the one their sets were kept under, and a row left out
            // nowhere, since it is gone
            for (const relatedId of members) {
                const inverseKey: string = inverseDriver.joinKey(relatedId, inverseSide);
                res.push({ type: moved.has(id) ? 'setAdd' : 'setRemove', key: inverseKey, members: [id] });
            }
        }
        return res;
    }

    /**
     * Makes a sequence hand out numbers from at least where another one is.
     *
     * Carried over rather than moved, and outside the transaction like every number a sequence hands
     * out: a rollback then leaves the sequence counting on from at least where the other one was, which
     * hands out no id twice. Nothing else writes it meanwhile, since booting holds the schema lock
     * while the migrations run.
     * @param currentSequenceKey - The key of the sequence to carry over.
     * @param sequenceKey - The key of the sequence that goes on from it.
     */
    private async carrySequence(currentSequenceKey: string, sequenceKey: string): Promise<void> {
        const carried: GlideString | null = await this.client.get(currentSequenceKey);
        const existing: GlideString | null = await this.client.get(sequenceKey);
        if (carried != undefined && (existing == undefined || Number(this.toStringValue(existing)) < Number(this.toStringValue(carried)))) {
            await this.client.set(sequenceKey, carried);
        }
    }

    /**
     * Works out what a row holds under each unique the entity declares.
     * @param fields - The row, as the json encoded fields it is stored as.
     * @returns One entry per unique that covers the row and whose values it holds, telling the uniques
     * apart.
     */
    private resolveTakenValues(fields: Record<string, string>): string[] {
        return this.uniqueGroups.flatMap(group => {
            const values: string | undefined = this.coveredBy(group, fields) ? this.uniqueValuesOf(group.properties, fields) : undefined;
            return values == undefined ? [] : [`${this.uniqueIdentity(group)}=${values}`];
        });
    }

    /**
     * Works out which unique values each written row gives up and which it takes up.
     * @param rows - The rows as they were stored and as they are stored now.
     * @param uniques - The uniques the store keeps.
     * @returns One change per row and declaration whose values differ, in the order of the rows.
     */
    private resolveUniqueIndexChanges(rows: StoredRowChange[], uniques: UniqueGroup[]): UniqueIndexChange[] {
        const changes: UniqueIndexChange[] = [];
        for (const { id, before, after } of rows) {
            for (const group of uniques) {
                const previous: string | undefined = before == undefined || !this.coveredBy(group, before)
                    ? undefined
                    : this.uniqueValuesOf(group.properties, before);
                // a row the declaration does not cover holds nothing as far as it is concerned, which
                // is also how a row leaves the index by being soft deleted rather than by changing
                // the value
                const next: string | undefined = after != undefined && this.coveredBy(group, after)
                    ? this.uniqueValuesOf(group.properties, after)
                    : undefined;
                if (previous !== next) {
                    changes.push({ id, group, previous, next });
                }
            }
        }
        return changes;
    }

    /**
     * The writes that stop every unique declaration of a deleted row pointing at it.
     * @param id - The id of the row being removed.
     * @param stored - The row as it is stored, json encoded the way the indexes were built from it.
     * Undefined when there is no such row, which leaves nothing to stop pointing.
     * @param uniques - The uniques the store keeps.
     * @returns The writes.
     */
    private resolveUniqueIndexRemovals(
        id: string,
        stored: Record<string, string> | undefined,
        uniques: UniqueGroup[]
    ): ValKeyBufferedWrite[] {
        if (stored == undefined) {
            return [];
        }
        return uniques.flatMap(group => {
            const values: string | undefined = this.uniqueValuesOf(group.properties, stored);
            return values == undefined
                ? []
                : [{ type: 'setRemove', key: this.uniqueKey(group, values), members: [id] } satisfies ValKeyBufferedWrite];
        });
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
     * row missing part of a group, or holding null for it, is not named by it and takes nothing up,
     * the way a sql unique counts it.
     */
    private uniqueValuesOf(group: string[], fields: Record<string, string>): string | undefined {
        const values: string[] = [];
        for (const key of group) {
            if (fields[key] == undefined || fields[key] === 'null') {
                return undefined;
            }
            values.push(`${key}=${fields[key]}`);
        }
        return values.join(':');
    }

    /**
     * Brings the indexes and uniques the store keeps for the entity in line with what it declares.
     *
     * Every declaration the store does not keep yet is listed first, so that every write from then on
     * keeps it, and then built over the rows stored before. A filter is answered from one only once it
     * is built. Every declaration the store keeps and the entity no longer declares is taken off the
     * list, and its keys are deleted. Run by booting, while it holds the schema lock.
     * @returns Whether a declaration was added or removed.
     * @throws When stored rows break a unique the entity declares. That unique is taken off the list
     * again, so nothing enforces or reads it.
     */
    async reconcileStoredKeys(): Promise<boolean> {
        const stored: StoredKeys = await this.readStoredKeys();
        const declared: KeyLists = { uniques: this.uniqueGroups, indexes: this.indexGroups };
        const declaredText: string = JsonUtilities.stringify(declared);
        const storedDeclarations: Map<string, KeyDeclaration> = this.resolveKeyDeclarations(stored);
        const declaredDeclarations: KeyDeclaration[] = [...this.resolveKeyDeclarations(declared).values()];
        const added: KeyDeclaration[] = declaredDeclarations.filter(d => !storedDeclarations.has(d.identity));
        const removed: KeyDeclaration[] = [...storedDeclarations.values()]
            .filter(s => !declaredDeclarations.some(d => d.identity === s.identity));
        const [built = []]: string[][] = await this.readSets([this.builtKey()], undefined);
        // with the ones listed and never built, which a boot that failed half way leaves behind
        const unbuilt: KeyDeclaration[] = declaredDeclarations.filter(d => added.includes(d) || !built.includes(d.identity));
        if (stored.stored === declaredText && !unbuilt.length) {
            return false;
        }

        // whatever keys an added declaration has were left by nobody keeping them, since no list
        // named it - and an entry nobody keeps would be read as one somebody does
        await this.deleteKeysOf(added);
        await this.replaceStoredKeys(declaredText, [...added, ...removed]);
        // after the list rather than before it, so that no write is still adding to them: one that
        // read the old list is refused when it is applied, and reads the new one
        await this.deleteKeysOf(removed);
        await this.buildKeys(unbuilt, declared);
        return added.length > 0 || removed.length > 0;
    }

    /**
     * Indexes every stored row under the given declarations, and names each of them built once it is.
     *
     * A row is added only while it still holds exactly what it was read with. One written in between
     * is a row its writer already keeps under them, having read the list they are on, and an entry
     * made from the older read would name a value it no longer holds.
     * @param declarations - The declarations to build.
     * @param declared - Everything the entity declares, which a unique the rows break is taken out of.
     * @throws When two stored rows hold the values one of the uniques names.
     */
    private async buildKeys(declarations: KeyDeclaration[], declared: KeyLists): Promise<void> {
        if (!declarations.length) {
            return;
        }
        // a batch of rows at a time, so that building holds as much as a stream does
        for (const ids of PromiseUtilities.resolveChunks(await this.readIds(undefined), STREAM_BATCH_SIZE)) {
            const rows: [string, string, string[], [string, boolean][]][] = [];
            for (const [id, fields] of await this.readRows(ids, undefined)) {
                const entries: BuiltEntry[] = declarations.flatMap(d => this.resolveBuiltEntries(d, fields));
                if (entries.length) {
                    const entryPairs: [string, boolean][] = entries.map(e => [e.key, e.unique]);
                    rows.push([this.rowKey(id), id, Object.entries(fields).flat(), entryPairs]);
                }
            }
            if (!rows.length) {
                continue;
            }
            const conflicts: string[] = this.toReplyStrings(await this.client.invokeScript(resolveBuildEntriesScript(), {
                keys: rows.flatMap(([rowKey, , , entries]) => [rowKey, ...entries.map(([key]) => key)]),
                args: [JsonUtilities.stringify(rows)]
            }));
            if (conflicts.length) {
                throw await this.dropBrokenUniques(conflicts, declarations, declared);
            }
        }
        await this.writeAll([{ type: 'setAdd', key: this.builtKey(), members: declarations.map(d => d.identity) }], undefined);
    }

    /**
     * Takes the uniques the stored rows break back off the list.
     * @param conflicts - What building answered: an entry, the row already holding it, and the row
     * that also does, in turn.
     * @param declarations - The declarations being built.
     * @param declared - Everything the entity declares.
     * @returns The error to refuse to go on with, naming the values two rows share.
     */
    private async dropBrokenUniques(conflicts: string[], declarations: KeyDeclaration[], declared: KeyLists): Promise<InternalError> {
        const entryKeys: string[] = conflicts.filter((_, i) => i % 3 === 0);
        const broken: KeyDeclaration[] = declarations
            .filter(d => d.unique != undefined && entryKeys.some(key => key.startsWith(d.keyPrefix)));
        const brokenIdentities: Set<string> = new Set(broken.map(d => d.identity));
        // so that nothing enforces a unique the stored rows already break, and nothing reads it
        const kept: KeyLists = {
            uniques: declared.uniques.filter(u => !brokenIdentities.has(this.uniqueIdentity(u))),
            indexes: declared.indexes
        };
        await this.replaceStoredKeys(JsonUtilities.stringify(kept), broken);
        await this.deleteKeysOf(broken);

        const [entryKey = '', holder = '', id = ''] = conflicts;
        const declaration: KeyDeclaration | undefined = broken.find(d => entryKey.startsWith(d.keyPrefix));
        return new InternalError([
            `Cannot keep ${this.entityClass.name} unique by ${declaration?.properties.join(', ') ?? entryKey}:`,
            `the stored rows ${holder} and ${id} both hold ${entryKey.slice(declaration?.keyPrefix.length ?? 0)}.`,
            'Remove the duplicates in a migration.'
        ]);
    }

    /**
     * Works out the entries a row holds under a declaration.
     * @param declaration - The declaration.
     * @param fields - The row, as the json encoded fields it is stored as.
     * @returns Its entry, or none when the row holds no value for the declaration or a unique leaves
     * it out.
     */
    private resolveBuiltEntries(declaration: KeyDeclaration, fields: Record<string, string>): BuiltEntry[] {
        if (declaration.unique == undefined) {
            const values: string | undefined = this.indexValuesOf(declaration.properties, fields);
            return values == undefined ? [] : [{ key: this.indexKey(declaration.properties, values), unique: false }];
        }
        const values: string | undefined = this.coveredBy(declaration.unique, fields)
            ? this.uniqueValuesOf(declaration.properties, fields)
            : undefined;
        return values == undefined ? [] : [{ key: this.uniqueKey(declaration.unique, values), unique: true }];
    }

    /**
     * Lists the store keeps, and names which declarations are no longer built, as one step.
     * @param stored - The list to keep, as it is stored.
     * @param unbuilt - The declarations that are not built from now on.
     */
    private async replaceStoredKeys(stored: string, unbuilt: KeyDeclaration[]): Promise<void> {
        const batch: Batch = new (valKeyGlide().Batch)(true);
        batch.set(this.keysKey(), stored);
        if (unbuilt.length) {
            // eslint-disable-next-line cspell/spellchecker
            batch.srem(this.builtKey(), unbuilt.map(d => d.identity));
        }
        await this.client.exec(batch, true);
    }

    /**
     * Deletes every key holding an entry of the given declarations.
     * @param declarations - The declarations.
     */
    private async deleteKeysOf(declarations: KeyDeclaration[]): Promise<void> {
        const keys: string[][] = await Promise.all(declarations.map(async d => await scanValKeyKeys(this.client, `${d.keyPrefix}*`)));
        await this.writeAll(keys.flat().map((key): ValKeyBufferedWrite => ({ type: 'delete', key })), undefined);
    }

    /**
     * Works out how the reconciliation tells each declaration of a list apart.
     * @param lists - The indexes and uniques.
     * @returns Each declaration, by its identity.
     */
    private resolveKeyDeclarations(lists: KeyLists): Map<string, KeyDeclaration> {
        const res: Map<string, KeyDeclaration> = new Map();
        for (const unique of lists.uniques) {
            const identity: string = this.uniqueIdentity(unique);
            res.set(identity, { identity, keyPrefix: this.uniqueKey(unique, ''), properties: unique.properties, unique });
        }
        for (const index of lists.indexes) {
            const identity: string = `index:${index.join(',')}`;
            res.set(identity, { identity, keyPrefix: this.indexKey(index, ''), properties: index, unique: undefined });
        }
        return res;
    }

    private uniqueIdentity(group: UniqueGroup): string {
        return `unique:${this.uniqueSegment(group)}`;
    }

    /**
     * Names a unique declaration the way its keys are named.
     * @param group - The declaration.
     * @returns Its properties, and a short hash of its filter when it covers only some rows - two over
     * the same properties covering different rows are two declarations, enforced by keys of their own.
     */
    private uniqueSegment(group: UniqueGroup): string {
        if (coversEveryRow(group.where)) {
            return group.properties.join(',');
        }
        const hash: string = createHash('sha256')
            .update(JsonUtilities.stringify(group.where))
            .digest('hex')
            .slice(0, 8);
        return `${group.properties.join(',')}#${hash}`;
    }

    /**
     * Collects the index declarations a filter can be answered from.
     * @param indexes - The declarations, a property carrying `index` being a group of one.
     * @returns The groups, each sorted, without duplicates and without a group naming an encrypted or
     * hashed property.
     */
    private resolveIndexGroups(indexes: string[][]): string[][] {
        const seen: Set<string> = new Set();
        return indexes
            .map(group => [...group].sort())
            .filter(group => group.every(key => !this.isTransformedOnWrite(this.properties[key])))
            .filter(group => {
                const id: string = group.join(',');
                if (seen.has(id)) {
                    return false;
                }
                seen.add(id);
                return true;
            });
    }

    private isTransformedOnWrite(metadata: PropertyMetadata | undefined): boolean {
        return metadata != undefined
            && (('encryption' in metadata && metadata.encryption != undefined && metadata.encryption !== false)
                || ('hash' in metadata && metadata.hash != undefined && metadata.hash !== false));
    }

    /**
     * The writes that move rows between the entries of every index declaration.
     *
     * Plain set operations, which commute: two rows changing different values never have to be
     * ordered against each other, so none of this takes a grant.
     * @param rows - The rows as they were stored and as they are stored now.
     * @param indexes - The indexes the store keeps.
     * @returns The writes, nothing for a row whose indexed values stayed the same.
     */
    private resolveIndexWrites(rows: StoredRowChange[], indexes: string[][]): ValKeyBufferedWrite[] {
        const writes: ValKeyBufferedWrite[] = [];
        for (const { id, before, after } of rows) {
            for (const group of indexes) {
                const previous: string | undefined = this.indexValuesOf(group, before);
                writes.push(...this.resolveIndexEntryWrites(id, group, previous, this.indexValuesOf(group, after)));
            }
        }
        return writes;
    }

    private resolveIndexEntryWrites(
        id: string,
        group: string[],
        previous: string | undefined,
        next: string | undefined
    ): ValKeyBufferedWrite[] {
        const writes: ValKeyBufferedWrite[] = [];
        if (previous === next) {
            return writes;
        }
        if (previous != undefined) {
            writes.push({ type: 'setRemove', key: this.indexKey(group, previous), members: [id] });
        }
        if (next != undefined) {
            writes.push({ type: 'setAdd', key: this.indexKey(group, next), members: [id] });
        }
        return writes;
    }

    /**
     * Reads the values an index declaration names off a stored row.
     * @param group - The properties of the declaration.
     * @param fields - The row, as the json encoded fields it is stored as. Undefined for no row at all.
     * @returns The values as one string, or undefined when the row holds no value for one of them. A
     * filter naming null is never answered from an index, so a row holding none needs no entry.
     */
    private indexValuesOf(group: string[], fields: Record<string, string> | undefined): string | undefined {
        const values: string[] = [];
        for (const key of group) {
            const stored: string | undefined = fields?.[key];
            if (stored == undefined || stored === 'null') {
                return undefined;
            }
            values.push(`${key}=${stored}`);
        }
        return values.join(':');
    }

    /**
     * Resolves the candidate ids of a filter whose every branch names every property of a built index
     * with plain values.
     *
     * The rows read are still judged by the whole filter, so an entry that no longer holds costs a
     * read and never a wrong answer.
     * @param where - The where filter of the query.
     * @param transaction - The transaction to read through.
     * @returns The candidate ids, or undefined when a branch names no index or an index it names is not
     * built yet.
     */
    private async idsFromIndexFilter(
        where: DriverFindOptions<T>['where'],
        transaction: ValKeyTransaction | undefined
    ): Promise<string[] | undefined> {
        if (where == undefined || !this.indexGroups.length) {
            return undefined;
        }
        const filters: WhereFilter<T>[] = Array.isArray(where) ? where : [where];
        const named: Set<string> = new Set();
        const entryKeys: string[] = [];
        for (const filter of filters) {
            const lookup: IndexLookup | undefined = this.indexLookupForFilter(filter);
            if (lookup == undefined) {
                return undefined;
            }
            named.add(`index:${lookup.group.join(',')}`);
            entryKeys.push(...lookup.keys);
        }

        // whether each index is built, and what it holds, in one round trip
        const [built = [], ...entries]: string[][] = await this.readSets([this.builtKey(), ...entryKeys], transaction);
        if ([...named].some(identity => !built.includes(identity))) {
            return undefined;
        }
        return [...new Set(entries.flat())];
    }

    /**
     * Finds the first index declaration a single filter names in full, and the entries it reads.
     * @param filter - One branch of the where filter.
     * @returns The declaration and its entry keys, or undefined when no declaration is named by plain
     * values. A declaration of one property may also be named by a `oneOf` of plain values.
     */
    private indexLookupForFilter(filter: WhereFilter<T>): IndexLookup | undefined {
        const conditions: Record<string, unknown> = filter as Record<string, unknown>;
        for (const group of this.indexGroups) {
            const [only] = group;
            const listed: unknown[] | undefined = group.length === 1 && only != undefined
                ? this.findPlainOneOf(conditions[only])
                : undefined;
            if (only != undefined && listed != undefined) {
                return { group, keys: listed.map(v => this.indexKey(group, `${only}=${this.encodeFilterValue(only, v)}`)) };
            }
            if (group.every(key => this.isPlainValue(conditions[key]))) {
                const values: string = group.map(key => `${key}=${this.encodeFilterValue(key, conditions[key])}`).join(':');
                return { group, keys: [this.indexKey(group, values)] };
            }
        }
        return undefined;
    }

    // the values of a `oneOf` that lists plain values only, each of which is one entry
    private findPlainOneOf(condition: unknown): unknown[] | undefined {
        if (typeof condition !== 'object' || condition == undefined || !('oneOf' in condition) || !Array.isArray(condition.oneOf)) {
            return undefined;
        }
        const listed: unknown[] = condition.oneOf;
        return listed.every(v => this.isPlainValue(v)) ? listed : undefined;
    }

    private isPlainValue(value: unknown): boolean {
        // an operator may match several values, and null matches rows holding none - neither is an entry
        return value != undefined && (typeof value !== 'object' || value instanceof Date);
    }

    // encoded the way a write encodes the value into its field, so the entry a filter names is the one
    // the row was put under
    private encodeFilterValue(key: string, value: unknown): string {
        const metadata: PropertyMetadata | undefined = this.properties[key];
        return JsonUtilities.stringify(metadata == undefined ? toJsonValue(value) : this.toStorableValue(value, metadata));
    }

    private indexKey(group: string[], values: string): string {
        return `${this.keyPrefix}:${this.tableName}:index:${group.join(',')}:${values}`;
    }

    private builtKey(): string {
        return `${this.keyPrefix}:${this.tableName}:built`;
    }

    private keysKey(): string {
        return `${this.keyPrefix}:${this.tableName}:keys`;
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
        const rows: Map<string, Record<string, string>> = await this.readRows(ids, transaction);
        const entities: T[] = ids.flatMap(id => {
            const row: Record<string, string> | undefined = rows.get(id);
            return row == undefined ? [] : [this.fromFields(row)];
        });

        if (relationsById == undefined) {
            await this.resolveRelationsOf(entities, relationsToResolve, transaction);
            return entities;
        }
        // rows asking for the same relations are resolved together, so a batch costs a read per
        // distinct set of relations rather than one per row
        const groups: Map<string, RowsAskingAlike<T>> = new Map();
        for (const entity of entities) {
            const relations: RelationTree = relationsById.get(entity.id) ?? relationsToResolve;
            const signature: string = this.treeSignatureOf(relations);
            const group: RowsAskingAlike<T> = groups.get(signature) ?? { relations, entities: [] };
            group.entities.push(entity);
            groups.set(signature, group);
        }
        await Promise.all([...groups.values()].map(async g => await this.resolveRelationsOf(g.entities, g.relations, transaction)));
        return entities;
    }

    /**
     * Writes a tree of relations as text, the same for two trees holding the same relations.
     * @param tree - The tree.
     * @returns The text.
     */
    private treeSignatureOf(tree: RelationTree): string {
        return [...tree]
            .map(([key, below]) => `${key}(${this.treeSignatureOf(below)})`)
            .sort()
            .join(',');
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
        return EntityRelationsUtilities.mergeTrees(
            EntityRelationsUtilities.resolveTree(options.relations),
            this.relationsForReading(options)
        );
    }

    /**
     * The relations a filter or an order cannot be answered without, which every row they look at
     * needs resolved before it can be judged.
     * @param options - The find options.
     * @returns Those relations.
     */
    private relationsForReading(options: DriverFindOptions<T>): RelationTree {
        // as deep as the filter reaches: one naming a relation of a relation is judged against it, and
        // resolving only the first level left the second unread, so the filter matched nothing
        const forFilter: RelationTree = EntityRelationsUtilities.resolveFilterTree(options.where, this.properties);
        return EntityRelationsUtilities.mergeTrees(EntityOrderUtilities.resolveRelations(options.order), forFilter);
    }

    /**
     * Resolves relations on many rows at once: one read per relation for all of them, rather than one
     * per row.
     * @param entities - The rows, changed in place.
     * @param relations - The relations to resolve, and those to resolve below each of them.
     * @param transaction - The transaction to read through.
     */
    private async resolveRelationsOf(entities: T[], relations: RelationTree, transaction: ValKeyTransaction | undefined): Promise<void> {
        if (!entities.length) {
            return;
        }
        await Promise.all([...relations].map(async ([key, below]) => {
            const metadata: PropertyMetadata | undefined = this.properties[key];
            if (metadata == undefined || !this.isRelation(metadata)) {
                return;
            }
            const resolved: Map<string, unknown> = await this.resolveRelationOf(entities, key, metadata, below, transaction);
            for (const entity of entities) {
                // a copy for each row: rows sharing a related row would otherwise share one object, and
                // the hooks a row goes through on its way out change it in place
                (entity as Record<string, unknown>)[key] = ObjectUtilities.copyDeep(resolved.get(entity.id));
            }
        }));
    }

    /**
     * Reads what one relation holds for each of the given rows.
     * @param entities - The rows.
     * @param key - The relation's property.
     * @param metadata - The relation's metadata.
     * @param below - The relations to resolve on what it holds.
     * @param transaction - The transaction to read through.
     * @returns What the relation holds, by the id of the row holding it. A row holding nothing is left out.
     */
    private async resolveRelationOf(
        entities: T[],
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        below: RelationTree,
        transaction: ValKeyTransaction | undefined
    ): Promise<Map<string, unknown>> {
        const targetDriver: ValKeyRepositoryDriver<BaseEntity> = new ValKeyRepositoryDriver(
            metadata.target(),
            this.client,
            this.keyPrefix,
            this.dataSource
        );
        switch (metadata.type) {
            case Relation.MANY_TO_ONE:
            case Relation.BELONGS_TO_ONE: {
                return await this.resolveToOneOf(entities, this.resolveJoinColumn(metadata, key), targetDriver, below, transaction);
            }
            case Relation.ONE_TO_MANY:
            case Relation.HAS_ONE: {
                const owned: Map<string, BaseEntity[]> = await this.resolveOwnedOf(
                    entities,
                    key,
                    metadata,
                    targetDriver,
                    below,
                    transaction
                );
                return metadata.type === Relation.HAS_ONE
                    ? new Map([...owned].map(([id, rows]) => [id, rows.at(0)]))
                    : owned;
            }
            case Relation.MANY_TO_MANY: {
                return await this.resolveManyToManyOf(entities, key, targetDriver, below, transaction);
            }
        }
    }

    /**
     * Reads the row a to one relation points at, for each of the given rows.
     * @param entities - The rows.
     * @param joinColumn - The property holding the foreign key.
     * @param targetDriver - The driver of the rows pointed at.
     * @param below - The relations to resolve on them.
     * @param transaction - The transaction to read through.
     * @returns The row pointed at, by the id of the row pointing.
     */
    private async resolveToOneOf(
        entities: T[],
        joinColumn: string,
        targetDriver: ValKeyRepositoryDriver<BaseEntity>,
        below: RelationTree,
        transaction: ValKeyTransaction | undefined
    ): Promise<Map<string, unknown>> {
        const foreignKeys: Map<string, string> = new Map();
        for (const entity of entities) {
            const foreignKey: unknown = (entity as Record<string, unknown>)[joinColumn];
            if (foreignKey != undefined) {
                // eslint-disable-next-line typescript/no-base-to-string
                foreignKeys.set(entity.id, String(foreignKey));
            }
        }
        // by the id as text, which is how a foreign key is looked up - a numeric id is read back as a number
        const targets: Map<string, BaseEntity> = new Map(
            (await targetDriver.findByIds([...new Set(foreignKeys.values())], { relations: below }, transaction))
                .map(t => [String(t.id), t])
        );
        return new Map([...foreignKeys].map(([id, foreignKey]) => [id, targets.get(foreignKey)]));
    }

    /**
     * Reads the rows of a one to many or has one relation, for each of the given rows.
     * @param entities - The rows owning them.
     * @param key - The relation's property.
     * @param metadata - The relation's metadata.
     * @param targetDriver - The driver of the owned rows.
     * @param below - The relations to resolve on them.
     * @param transaction - The transaction to read through.
     * @returns The owned rows, by the id of their owner. Every owner is in it, one owning nothing with none.
     * @throws When the relation names an inverse side its target does not declare.
     */
    private async resolveOwnedOf(
        entities: T[],
        key: string,
        metadata: RelationMetadata<BaseEntity>,
        targetDriver: ValKeyRepositoryDriver<BaseEntity>,
        below: RelationTree,
        transaction: ValKeyTransaction | undefined
    ): Promise<Map<string, BaseEntity[]>> {
        const targetClass: Newable<BaseEntity> = metadata.target();
        const inverse: PropertyMetadata | undefined = MetadataUtilities.getModelProperties(targetClass)[metadata.inverseSide];
        if (inverse == undefined || !this.isRelation(inverse)) {
            throw new InternalError(
                `Could not find the inverse relation "${metadata.inverseSide}" on ${targetClass.name} for ${this.entityClass.name}.${key}.`
            );
        }
        const foreignKeyColumn: string = this.resolveJoinColumn(inverse, metadata.inverseSide);
        // through the transaction, so that rows written in it and not yet committed are found
        const targets: BaseEntity[] = await targetDriver.find({
            where: { [foreignKeyColumn]: { oneOf: entities.map(e => e.id) } } as Where<BaseEntity>,
            relations: below,
            transaction
        });

        // keyed by the id as it was read rather than as text, since that is the value the foreign key
        // holds - a number for a numeric id
        const byOwner: Map<unknown, BaseEntity[]> = new Map(entities.map(e => [e.id, []]));
        for (const target of targets) {
            byOwner.get(Reflect.get(target, foreignKeyColumn))?.push(target);
        }
        return new Map(entities.map(e => [e.id, byOwner.get(e.id) ?? []]));
    }

    /**
     * Reads the rows of a many to many relation, for each of the given rows.
     * @param entities - The rows.
     * @param key - The relation's property.
     * @param targetDriver - The driver of the related rows.
     * @param below - The relations to resolve on them.
     * @param transaction - The transaction to read through.
     * @returns The related rows, in the order their set holds them, by the id of the row relating them.
     */
    private async resolveManyToManyOf(
        entities: T[],
        key: string,
        targetDriver: ValKeyRepositoryDriver<BaseEntity>,
        below: RelationTree,
        transaction: ValKeyTransaction | undefined
    ): Promise<Map<string, BaseEntity[]>> {
        const sets: string[][] = await this.readSets(entities.map(e => this.joinKey(e.id, key)), transaction);
        // by the id as text, which is what a set holds
        const targets: Map<string, BaseEntity> = new Map(
            (await targetDriver.findByIds([...new Set(sets.flat())], { relations: below }, transaction)).map(t => [String(t.id), t])
        );
        const res: Map<string, BaseEntity[]> = new Map();
        for (const [i, entity] of entities.entries()) {
            res.set(entity.id, (sets[i] ?? []).flatMap(id => {
                const target: BaseEntity | undefined = targets.get(id);
                return target == undefined ? [] : [target];
            }));
        }
        return res;
    }

    /**
     * The writes that bring the many to many relations provided with the given rows up to date: one
     * read per relation for all of the rows, rather than one per row.
     * @param entries - The rows being saved, each with its id.
     * @param transaction - The transaction to run the operation in.
     * @returns The writes.
     * @throws When a many to many relation was given something other than an array.
     */
    private async resolveManyToManyWrites(
        entries: [DeepPartial<T>, string][],
        transaction: ValKeyTransaction | undefined
    ): Promise<ValKeyBufferedWrite[]> {
        const writes: ValKeyBufferedWrite[] = [];
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (metadata.type !== Relation.MANY_TO_MANY) {
                continue;
            }
            const given: [unknown[], string][] = this.resolveGivenMembers(entries, key);
            if (!given.length) {
                continue;
            }

            const stored: string[][] = await this.readSets(given.map(([, id]) => this.joinKey(id, key)), transaction);
            const wanted: string[][] = await this.resolveRelatedIdsOf(metadata, given.map(([members]) => members), transaction);
            // both sides of the relation keep their own set, so the inverse side has to be updated too
            const inverseDriver: ValKeyRepositoryDriver<BaseEntity> = new ValKeyRepositoryDriver(
                metadata.target(),
                this.client,
                this.keyPrefix,
                this.dataSource
            );
            const inverseJoinKey: (relatedId: string) => string = inverseDriver.joinKeyOf(metadata.inverseSide);
            for (const [i, [, id]] of given.entries()) {
                writes.push(...this.resolveSetChanges(id, key, stored[i] ?? [], wanted[i] ?? [], inverseJoinKey));
            }
        }
        return writes;
    }

    /**
     * The members each row was given for a many to many relation, for the rows that were given any.
     * @param entries - The rows being saved, each with its id.
     * @param key - The relation's property.
     * @returns The members and the id of the row they were given with.
     * @throws When a row was given something other than an array.
     */
    private resolveGivenMembers(entries: [DeepPartial<T>, string][], key: string): [unknown[], string][] {
        const res: [unknown[], string][] = [];
        for (const [entry, id] of entries) {
            const value: unknown = (entry as Record<string, unknown>)[key];
            if (value == undefined) {
                continue;
            }
            if (!Array.isArray(value)) {
                throw new InternalError(`The many to many relation "${this.entityClass.name}.${key}" needs to be an array.`);
            }
            res.push([value, id]);
        }
        return res;
    }

    /**
     * The writes that turn one row's set of a many to many relation from what it holds into what it
     * was given, on both sides of the relation.
     * @param id - The id of the row.
     * @param key - The relation's property.
     * @param stored - The ids the row's set holds.
     * @param wanted - The ids it was given.
     * @param inverseJoinKey - Builds the key of the set a related row keeps on the other side.
     * @returns The writes.
     */
    private resolveSetChanges(
        id: string,
        key: string,
        stored: string[],
        wanted: string[],
        inverseJoinKey: (relatedId: string) => string
    ): ValKeyBufferedWrite[] {
        const writes: ValKeyBufferedWrite[] = [];
        const joinKey: string = this.joinKey(id, key);
        const toRemove: string[] = stored.filter(s => !wanted.includes(s));
        if (toRemove.length) {
            writes.push({ type: 'setRemove', key: joinKey, members: toRemove });
        }
        if (wanted.length) {
            writes.push({ type: 'setAdd', key: joinKey, members: wanted });
        }
        for (const relatedId of toRemove) {
            writes.push({ type: 'setRemove', key: inverseJoinKey(relatedId), members: [id] });
        }
        for (const relatedId of wanted.filter(w => !stored.includes(w))) {
            writes.push({ type: 'setAdd', key: inverseJoinKey(relatedId), members: [id] });
        }
        return writes;
    }

    /**
     * Resolves the ids of the members of a many to many relation, for several rows at once.
     *
     * Members that do not have an id yet are inserted first, all of them in one save, but only when the
     * relation has the cascade insert flag set. Without it they cannot be referenced and are rejected.
     * @param metadata - The metadata of the relation.
     * @param memberLists - The members provided with each saved row.
     * @param transaction - The transaction to run the operation in.
     * @returns The ids of the members, a list per row in the order the rows were given.
     * @throws When a member has no id and the relation does not cascade inserts.
     */
    private async resolveRelatedIdsOf(
        metadata: RelationMetadata<BaseEntity>,
        memberLists: unknown[][],
        transaction: ValKeyTransaction | undefined
    ): Promise<string[][]> {
        const targetClass: Newable<BaseEntity> = metadata.target();
        const unsaved: DeepPartial<BaseEntity>[] = memberLists.flat()
            .map(member => member as DeepPartial<BaseEntity>)
            .filter(member => member.id == undefined);
        if (unsaved.length && !this.hasCascadeInsert(metadata)) {
            throw new InternalError(
                `Could not save the relation "${this.entityClass.name}.${metadata.inverseSide}": `
                + `the given ${targetClass.name} has no id and the relation does not cascade inserts.`
            );
        }

        const targetDriver: ValKeyRepositoryDriver<BaseEntity> = new ValKeyRepositoryDriver(
            targetClass,
            this.client,
            this.keyPrefix,
            this.dataSource
        );
        // handed back in the order they were given, which is the order they are taken out again below
        const saved: BaseEntity[] = await targetDriver.save(unsaved, transaction, true);
        if (saved.length !== unsaved.length) {
            throw new InternalError(`Saving ${unsaved.length} ${targetClass.name} returned ${saved.length} rows.`);
        }

        let next: number = 0;
        return memberLists.map(members => members.map(member => {
            const id: unknown = (member as DeepPartial<BaseEntity>).id;
            if (id != undefined) {
                // eslint-disable-next-line typescript/no-base-to-string
                return String(id);
            }
            return String(saved[next++]?.id);
        }));
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

    /**
     * The writes that take removed rows out of every many to many relation they are part of.
     *
     * One read per relation for all of the rows, rather than one per row.
     * @param ids - The ids of the rows being removed.
     * @param transaction - The transaction to read through.
     * @returns The writes.
     */
    private async resolveManyToManyRemovals(ids: string[], transaction: ValKeyTransaction | undefined): Promise<ValKeyBufferedWrite[]> {
        const writes: ValKeyBufferedWrite[] = [];
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (metadata.type !== Relation.MANY_TO_MANY) {
                continue;
            }
            const inverseDriver: ValKeyRepositoryDriver<BaseEntity> = new ValKeyRepositoryDriver(
                metadata.target(),
                this.client,
                this.keyPrefix,
                this.dataSource
            );

            // a removed entity must not stay behind in the sets of the entities it was related to
            const related: string[][] = await this.readSets(ids.map(id => this.joinKey(id, key)), transaction);
            for (const [i, id] of ids.entries()) {
                for (const relatedId of related[i] ?? []) {
                    writes.push({ type: 'setRemove', key: inverseDriver.joinKey(relatedId, metadata.inverseSide), members: [id] });
                }
                writes.push({ type: 'delete', key: this.joinKey(id, key) });
            }
        }
        return writes;
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
            res[key] = JsonUtilities.stringify(this.toStorableValue(value, metadata));
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
        fields[this.resolveJoinColumn(metadata, key)] = JsonUtilities.stringify(String(value.id));
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
            const parsed: unknown = JsonUtilities.parse(raw);
            res[key] = metadata == undefined ? parsed : this.fromStorableValue(parsed, metadata);
        }
        return res as T;
    }

    private fromStorableValue(value: unknown, metadata: PropertyMetadata): unknown {
        if (value == undefined) {
            return value;
        }
        switch (metadata.type) {
            // a value that does not read as the declared type is handed back as it is stored, the way
            // a value inside an object is: turned into an invalid date or NaN it would be a different
            // value that nothing can tell from a real one, and a filter comparing it could not name it
            case 'date': {
                // eslint-disable-next-line typescript/no-base-to-string
                const date: Date = new Date(String(value));
                return Number.isNaN(date.getTime()) ? value : date;
            }
            case 'number': {
                return parseNumber(value, metadata.format);
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

        // read together rather than one after another: the branches of an or are independent, and an
        // upsert of a batch names one branch per row
        const perKey: string[][] = await this.readSets(keys, transaction);
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
                values.push(`${key}=${JsonUtilities.stringify(condition)}`);
            }
            if (values.length === group.properties.length) {
                return this.uniqueKey(group, values.join(':'));
            }
        }
        return undefined;
    }

    private async readIds(transaction: ValKeyTransaction | undefined): Promise<string[]> {
        const [ids = []]: string[][] = await this.readSets([this.idsKey()], transaction);
        return ids;
    }

    /**
     * Reads the members of sets.
     * @param keys - The keys of the sets.
     * @param transaction - The transaction whose writes are laid over what is stored, if any.
     * @returns The members of each set, in the order of the keys. A set that does not exist has none.
     */
    private async readSets(keys: string[], transaction: ValKeyTransaction | undefined): Promise<string[][]> {
        // eslint-disable-next-line cspell/spellchecker
        const replies: GlideReturnType[] = await this.readPipelined(keys, (batch, key) => batch.smembers(key));
        return keys.map((key, i) => {
            const stored: string[] = this.toMembers(replies[i]);
            return transaction ? transaction.resolveSetMembers(key, stored) : stored;
        });
    }

    /**
     * Reads rows by their ids.
     * @param ids - The ids of the rows.
     * @param transaction - The transaction whose writes are laid over what is stored, if any.
     * @returns The rows by their id, as the json encoded fields they are stored as. An id holding no
     * row is left out.
     */
    private async readRows(ids: string[], transaction: ValKeyTransaction | undefined): Promise<Map<string, Record<string, string>>> {
        const [rows]: [Map<string, Record<string, string>>, StoredKeys | undefined] = await this.readRowsAlongside(ids, transaction, false);
        return rows;
    }

    /**
     * Reads rows by their ids, and the indexes and uniques the store keeps, in one round trip.
     *
     * What a write reads, since what it writes besides the rows depends on both.
     * @param ids - The ids of the rows.
     * @param transaction - The transaction whose writes are laid over what is stored, if any.
     * @returns The rows by their id, as {@link ValKeyRepositoryDriver.readRows} reads them, and the
     * indexes and uniques.
     */
    private async readRowsAndKeys(
        ids: string[],
        transaction: ValKeyTransaction | undefined
    ): Promise<[Map<string, Record<string, string>>, StoredKeys]> {
        const [rows, keys]: [Map<string, Record<string, string>>, StoredKeys | undefined] = await this.readRowsAlongside(
            ids,
            transaction,
            true
        );
        return [rows, keys ?? { uniques: [], indexes: [], stored: '' }];
    }

    /**
     * Reads the indexes and uniques the store keeps.
     * @returns What the store lists.
     */
    private async readStoredKeys(): Promise<StoredKeys> {
        const [, keys]: [Map<string, Record<string, string>>, StoredKeys] = await this.readRowsAndKeys([], undefined);
        return keys;
    }

    /**
     * Reads rows by their ids, and the indexes and uniques the store keeps when asked to.
     * @param ids - The ids of the rows.
     * @param transaction - The transaction whose writes are laid over what is stored, if any.
     * @param withKeys - Whether to read the indexes and uniques along with them.
     * @returns The rows by their id, and the indexes and uniques when they were read.
     */
    private async readRowsAlongside(
        ids: string[],
        transaction: ValKeyTransaction | undefined,
        withKeys: boolean
    ): Promise<[Map<string, Record<string, string>>, StoredKeys | undefined]> {
        const wanted: string[] = [...new Set(ids)].filter(id => transaction?.isDeleted(this.rowKey(id)) !== true);
        const keysKey: string = this.keysKey();
        const replies: GlideReturnType[] = await this.readPipelined(
            [...withKeys ? [keysKey] : [], ...wanted.map(id => this.rowKey(id))],
            // eslint-disable-next-line cspell/spellchecker
            (batch, key) => key === keysKey ? batch.get(key) : batch.hgetall(key)
        );
        const rowReplies: GlideReturnType[] = withKeys ? replies.slice(1) : replies;

        const res: Map<string, Record<string, string>> = new Map();
        for (const [i, id] of wanted.entries()) {
            const stored: Record<string, string> | undefined = this.toRow(rowReplies[i]);
            const row: Record<string, string> | undefined = transaction ? transaction.resolveHash(this.rowKey(id), stored) : stored;
            if (row != undefined) {
                res.set(id, row);
            }
        }
        return [res, withKeys ? this.toStoredKeys(replies[0]) : undefined];
    }

    /**
     * Reads the indexes and uniques the store keeps out of a pipeline's reply.
     * @param reply - The reply to reading their list.
     * @returns What the list names, nothing when there is no list.
     * @throws When the list is not one this driver wrote.
     */
    private toStoredKeys(reply: GlideReturnType | undefined): StoredKeys {
        if (reply == undefined) {
            return { uniques: [], indexes: [], stored: '' };
        }
        const stored: string = this.toReplyString(reply);
        const lists: unknown = JsonUtilities.parse<unknown>(stored);
        if (!isKeyLists(lists)) {
            throw new InternalError(`The indexes and uniques kept for ${this.entityClass.name} are not a list this version can read.`);
        }
        return { uniques: lists.uniques, indexes: lists.indexes, stored };
    }

    /**
     * Applies writes as one step, but only while the indexes and uniques the store keeps are still the
     * ones they were worked out from.
     * @param writes - The writes, in the order they are applied.
     * @param keys - The indexes and uniques the writes were worked out from.
     * @returns True when the writes were applied, false when the list had changed and nothing was.
     */
    private async writeGuarded(writes: ValKeyBufferedWrite[], keys: StoredKeys): Promise<boolean> {
        return await applyGuardedValKeyWrites(this.client, new Map([[this.keysKey(), keys.stored]]), writes);
    }

    /**
     * Sends one read per key, a pipeline of them at a time.
     *
     * Pipelined rather than one request each, because a read of a batch is as large as its caller
     * made it, and a round trip per key is both the whole cost of reading them and more requests than
     * a client holds in flight at once.
     * @param keys - The keys to read.
     * @param read - Queues the read of one key.
     * @returns The reply to each read, in the order of the keys.
     */
    private async readPipelined(keys: string[], read: (batch: Batch, key: string) => void): Promise<GlideReturnType[]> {
        const replies: GlideReturnType[][] = await PromiseUtilities.allChunked(
            PromiseUtilities.resolveChunks(keys, READS_PER_PIPELINE),
            async group => {
                // not atomic: these are reads, and a pipeline only has to spare the round trips
                const batch: Batch = new (valKeyGlide().Batch)(false);
                for (const key of group) {
                    read(batch, key);
                }
                const res: GlideReturnType[] | null = await this.client.exec(batch, true);
                if (res?.length !== group.length) {
                    throw new InternalError(`A pipeline of ${group.length} reads was answered with ${res?.length ?? 'nothing'}.`);
                }
                return res;
            }
        );
        return replies.flat();
    }

    /**
     * Reads the members of a set out of a pipeline's reply.
     * @param reply - The reply to reading the set.
     * @returns The members.
     * @throws When the reply is not a set.
     */
    private toMembers(reply: GlideReturnType | undefined): string[] {
        if (!(reply instanceof Set)) {
            throw new InternalError('Reading a set was not answered with a set.');
        }
        return [...reply].map(member => this.toReplyString(member));
    }

    /**
     * Reads a row out of a pipeline's reply.
     * @param reply - The reply to reading the hash, a list of its fields and their values.
     * @returns The fields, or undefined when there is no row.
     * @throws When the reply is not a list of fields and values.
     */
    private toRow(reply: GlideReturnType | undefined): Record<string, string> | undefined {
        if (!Array.isArray(reply)) {
            throw new InternalError('Reading a row was not answered with its fields.');
        }
        if (!reply.length) {
            return undefined;
        }
        return Object.fromEntries(reply.map(entry => {
            if (!this.isReplyRecord(entry)) {
                throw new InternalError('Reading a row was not answered with its fields.');
            }
            return [this.toReplyString(entry['key']), this.toReplyString(entry['value'])];
        }));
    }

    private isReplyRecord(reply: GlideReturnType): reply is Record<string, GlideReturnType> {
        return typeof reply === 'object'
            && reply != undefined
            && !Array.isArray(reply)
            && !(reply instanceof Set)
            && !(reply instanceof Map)
            && !(reply instanceof Error)
            && !Buffer.isBuffer(reply);
    }

    private toReplyString(reply: GlideReturnType | undefined): string {
        if (typeof reply === 'string') {
            return reply;
        }
        if (Buffer.isBuffer(reply)) {
            return this.toStringValue(reply);
        }
        throw new InternalError('A read was answered with something other than text.');
    }

    private toReplyStrings(reply: GlideReturnType): string[] {
        if (!Array.isArray(reply)) {
            throw new InternalError('A script was answered with something other than a list.');
        }
        return reply.map(entry => this.toReplyString(entry));
    }

    /**
     * Applies a write, either directly or by buffering it inside the given transaction.
     * @param write - The write to apply.
     * @param transaction - The transaction to buffer the write in, if any.
     */
    private async write(write: ValKeyBufferedWrite, transaction: ValKeyTransaction | undefined): Promise<void> {
        await this.writeAll([write], transaction);
    }

    /**
     * Applies writes, either by buffering them inside the given transaction or as one request.
     *
     * Without a transaction they go out as a pipeline rather than one request each, and not atomic:
     * nothing is held around them, so a pipeline promises no more than the separate requests did, and
     * costs one round trip instead of one per write.
     * @param writes - The writes, in the order they are applied.
     * @param transaction - The transaction to buffer them in, if any.
     */
    private async writeAll(writes: ValKeyBufferedWrite[], transaction: ValKeyTransaction | undefined): Promise<void> {
        if (transaction) {
            for (const write of writes) {
                await transaction.add(write);
            }
            return;
        }
        for (const group of PromiseUtilities.resolveChunks(writes, WRITES_PER_PIPELINE)) {
            const batch: Batch = new (valKeyGlide().Batch)(false);
            for (const write of group) {
                queueValKeyWrite(batch, write);
            }
            await this.client.exec(batch, true);
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

    private joinKeyOf(propertyKey: string): (id: string) => string {
        return id => this.joinKey(id, propertyKey);
    }

    private uniqueKey(group: UniqueGroup, values: string): string {
        return `${this.keyPrefix}:${this.tableName}:unique:${this.uniqueSegment(group)}:${values}`;
    }
}