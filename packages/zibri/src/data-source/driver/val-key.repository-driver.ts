import { createHash } from 'node:crypto';

import type { Batch, GlideClient, GlideReturnType, GlideString, Script } from '@valkey/valkey-glide';

import { RelatedRowsReader } from './related-rows-reader.interface';
import { RelationResolutionUtilities } from './relation-resolution.utilities';
import { RemovalReach } from './removal-reach.model';
import { DriverAggregateOptions, DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface, STREAM_BATCH_SIZE } from './repository-driver.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { PropertyMetadata, RelationMetadata } from '../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../entity/entity-metadata-missing.error';
import { EntityOrderUtilities, OrderComparator } from '../../entity/models/entity-order.utilities';
import { RelationTree, RelationTreeByRowId } from '../../entity/models/entity-relations.model';
import { EntityRelationsUtilities } from '../../entity/models/entity-relations.utilities';
import { Relation } from '../../entity/models/relation.enum';
import { coversEveryRow, KeyWhere, UniqueGroup } from '../../entity/models/unique-declaration.model';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { ModelRegistry } from '../../global/model-registry/model.registry';
import { $ts } from '../../localization/translate.function';
import { parseArray } from '../../parsing/functions/parse-array.function';
import { parseNumber } from '../../parsing/functions/parse-number.function';
import { parseObject } from '../../parsing/functions/parse-object.function';
import { parseOneOf } from '../../parsing/functions/parse-one-of.function';
import { toJsonValue } from '../../parsing/functions/to-json-value.function';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { BigNumber, NumberUtilities } from '../../utilities/number.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { AggregateUtilities } from '../aggregate.utilities';
import { CheckConstraintViolationError } from '../check-constraint-violation.error';
import { scanValKeyKeys } from '../data-sources/val-key/scan-val-key-keys.function';
import { type ValKeyDataSource } from '../data-sources/val-key/val-key-data-source.model';
import { valKeyGlide } from '../data-sources/val-key/val-key-glide.function';
import { ValKeyLockKeyUtilities } from '../data-sources/val-key/val-key-lock-key.utilities';
import { WhereFilterEvaluator } from '../data-sources/where-converter/where-filter.evaluator';
import { AggregateRow } from '../models/aggregate.model';
import { FindAllOptions } from '../models/options/find-all-options.model';
import { PaginationResult } from '../models/pagination-result.model';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { applyGuardedValKeyWrites } from '../transaction/apply-guarded-val-key-writes.function';
import { KeyDeclarationsChangedError } from '../transaction/key-declarations-changed.error';
import { queueValKeyWrite } from '../transaction/queue-val-key-write.function';
import { Transaction } from '../transaction/transaction.model';
import { ValKeyBufferedWrite, ValKeyTransaction } from '../transaction/val-key-transaction.model';
import { UnboundedReturnError } from '../unbounded-return.error';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';
import { UpsertIdentityUtilities } from '../upsert-identity.utilities';
import { WriteDataUtilities } from '../write-data.utilities';

// a stream reads its ids in one go because that is the small half, and the rows behind them, which
// is what would not fit, STREAM_BATCH_SIZE at a time

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
    conflictWhere: Where<T>,
    /**
     * What the row holding its identity has to match for the changes to apply, if anything.
     */
    where: Where<T> | undefined
};

/**
 * One key of an order: where its value is in a row, and how two of them compare.
 */
type OrderSort = {
    /**
     * The properties the value is reached through.
     */
    path: string[],
    /**
     * Compares two values in the direction of the key.
     */
    compare: OrderComparator
};

/**
 * What a stream in an order keeps of a matching row until it hands the rows out.
 */
type OrderedId = {
    /**
     * The id of the row.
     */
    id: string,
    /**
     * The values the order compares, one per key.
     */
    values: unknown[]
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
    indexes: string[][],
    /**
     * The checks every row is held to, absent when the entity declares none.
     */
    checks?: KeyWhere[]
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
 * The script reading sets with the rows behind them, once it has been built - on first use, for the
 * reason the scripts of the data source are.
 */
let readSetsWithRowsScript: Script | undefined;

/**
 * Reads sets, and the rows behind the first ids the sets from a given position on hold, up to a given
 * number of them.
 *
 * Answers the members of every set, the ids it read rows for, and each of those rows as a list of its
 * fields and values.
 * @returns The script.
 */
function resolveReadSetsWithRowsScript(): Script {
    readSetsWithRowsScript ??= new (valKeyGlide().Script)(
        'local sets, ids, seen = {}, {}, {} '
        + 'for i, key in ipairs(KEYS) do '
        // eslint-disable-next-line cspell/spellchecker
        + 'sets[i] = redis.call("smembers", key) '
        + 'if i > tonumber(ARGV[3]) then for _, id in ipairs(sets[i]) do '
        + 'if not seen[id] then seen[id] = true table.insert(ids, id) end '
        + 'end end '
        + 'end '
        + 'local read, rows = {}, {} '
        + 'for i = 1, math.min(#ids, tonumber(ARGV[2])) do '
        + 'read[i] = ids[i] '
        + 'rows[i] = redis.call("hgetall", ARGV[1] .. ids[i]) '
        + 'end '
        + 'return {sets, read, rows}'
    );
    return readSetsWithRowsScript;
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
        && value.indexes.every((index: unknown) => isTextList(index))
        && (
            !('checks' in value)
            || (
                Array.isArray(value.checks)
                && value.checks.every((check: unknown) => typeof check === 'object' && check != undefined)
            )
        );
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
 * What a save compares the rows it writes against, read in one round trip.
 */
type StoredRead = {
    /**
     * The stored rows by their id, as the json encoded fields they are stored as.
     */
    rows: Map<string, Record<string, string>>,
    /**
     * The indexes and uniques the store keeps.
     */
    keys: StoredKeys,
    /**
     * The rows holding each unique value read along with them, by the key of its index, as stored.
     * Read only for values the save held before reading them.
     */
    holders: Map<string, string[]>
};

/**
 * Rows a transaction holds, read once they were held, along with what the save writing them compares
 * them against.
 */
type HeldRows<T extends BaseEntity> = StoredRead & {
    /**
     * The rows.
     */
    entities: T[]
};

/**
 * Rows read in the round trip that read their ids, by their id, as the transaction reading them sees
 * them. Undefined for an id holding no row.
 */
type RowsReadAlong = Map<string, Record<string, string> | undefined>;

/**
 * Sets read in one round trip, and the rows behind the ids they hold.
 */
type SetsWithRows = {
    /**
     * The members of each set, in the order of their keys.
     */
    members: string[][],
    /**
     * The rows behind the ids, or undefined when they were not read along.
     */
    rows: RowsReadAlong | undefined
};

/**
 * The rows a filter may match, as far as it names them before any of them is judged.
 */
type Candidates = {
    /**
     * The ids of the rows.
     */
    ids: string[],
    /**
     * The rows read along with the ids, or undefined when they were not.
     */
    rows: RowsReadAlong | undefined
};

/**
 * How many reads one pipeline carries.
 *
 * Bounded rather than all of them in one, because a pipeline's replies are held until the last one
 * arrives and a read is as large as its caller made it.
 */
const READS_PER_PIPELINE: number = 1000;

/**
 * How many rows a find reads in the round trip that reads their ids, at most.
 *
 * Bounded because that read is one script, and the server answers nobody else while a script runs.
 * More rows are read in a round trip of their own, a pipeline at a time.
 */
const ROWS_READ_WITH_IDS: number = 1000;

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
 * the same answer a sql store gives to the same declaration. A value a transaction gives up stays
 * granted until it ends, so a write taking it up waits for the outcome rather than being refused, as
 * on a sql store. It costs a grant per changed value and a read per value taken up, so an update
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

    /**
     * The rules every row of the entity has to follow.
     */
    private readonly checks: KeyWhere[];

    /**
     * How the rows of a relation are read: through the driver of their own entity, through the
     * transaction so that rows written in it and not yet committed are found, and a many to many
     * relation's ids off the set each row keeps.
     */
    private readonly relatedRowsReader: RelatedRowsReader = {
        findRelated: async (target, where, below, related, transaction) => await new ValKeyRepositoryDriver(
            target,
            this.client,
            this.keyPrefix,
            this.dataSource
        ).find({ where, relations: below, related, transaction }),
        findRelatedIds: async (entities, key, metadata, transaction) => await this.readSets(
            entities.map(e => this.joinKey(e.id, key)),
            this.toValKeyTransaction(transaction)
        )
    };

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
        this.checks = (metadata.checks ?? []).map(check => check.where);
        this.properties = MetadataUtilities.getModelProperties(entityClass);
        this.uniqueGroups = this.resolveUniqueGroups();
        this.indexGroups = this.resolveIndexGroups(
            ModelRegistry.get(this.entityClass).keyDescriptor.indexes,
            ModelRegistry.get(this.entityClass).keyDescriptor.uniques
        );
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        return await this.saveRows(data, transaction, reload, false);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveDataSourceTime(): Promise<Date> {
        // filters are judged in this process, so the time they compare by is the server's, as the data
        // source follows it. Reading it off the server before every call cost a round trip each (02 §S21)
        return await this.dataSource.resolveServerTime();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        // a save of rows nobody stored knows the unique values they take up before it reads anything,
        // so it holds those along with the rows and reads who holds them along with the rows as well
        return await this.saveRows(data, transaction, true, true);
    }

    /**
     * Writes the rows, in a transaction of their own when the store keeps a unique.
     * @param data - The rows to write.
     * @param transaction - The transaction to write through, when there is one.
     * @param reload - Whether or not the written rows should be handed back.
     * @param inserting - Whether the rows are new ones.
     * @returns The written rows when they were asked for, an empty array otherwise.
     */
    private async saveRows(
        data: DeepPartial<T>[],
        transaction: Transaction | undefined,
        reload: boolean,
        inserting: boolean
    ): Promise<T[]> {
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
            return await this.saveThrough(data, this.toValKeyTransaction(transaction), reload, undefined, inserting);
        }
        return await this.inTransaction(transaction, async own => await this.saveThrough(data, own, reload, undefined, inserting));
    }

    /**
     * Writes the rows, their indexes and their relations.
     * @param data - The rows to write.
     * @param valKeyTransaction - The transaction to write through, when there is one.
     * @param reload - Whether or not the written rows should be handed back.
     * @param held - What the transaction read of the rows once it held them, if it did.
     * @param inserting - Whether the rows are new ones.
     * @returns The written rows when they were asked for, an empty array otherwise.
     */
    private async saveThrough(
        data: DeepPartial<T>[],
        valKeyTransaction: ValKeyTransaction | undefined,
        reload: boolean,
        held?: StoredRead,
        inserting: boolean = false
    ): Promise<T[]> {
        // for the reason a save without rows is: an update or upsert that matched nothing has no write
        if (!data.length) {
            return [];
        }
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
        // worked out once for new rows, before anything is read: the unique values they take up are
        // held along with them, and a default a function hands out would differ the second time
        const newFields: Map<string, Record<string, string>> = new Map(
            inserting ? entriesWithIds.map(([entry, id]) => [id, this.toFields(entry, true)]) : []
        );

        const { rows: existingRows, keys, holders }: StoredRead = await this.readStoredForSave(
            ids,
            valKeyTransaction,
            held,
            this.resolveTakenUniqueKeys(newFields, valKeyTransaction)
        );
        if (valKeyTransaction == undefined && keys.uniques.length) {
            // this version declares nothing unique, and the store enforces something all the same -
            // what a newer version declares. Saved the way that version saves, holding the rows first
            return await this.inTransaction(undefined, async own => await this.saveThrough(data, own, reload, undefined, inserting));
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
            const fields: Record<string, string> = existingRows.has(id)
                ? this.toFields(entry, false)
                : newFields.get(id) ?? this.toFields(entry, true);
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
        if (!await this.saveWithKeys(writes, changes, keys, valKeyTransaction, holders)) {
            // a transaction holds one of the rows, so the save waits for it in a transaction of its own
            // and reads the rows again once it has them: what it read here may be gone by then. Nothing
            // was written, so a row the call gave no id takes a new one
            return await this.inTransaction(undefined, async own => await this.saveThrough(data, own, reload, undefined, inserting));
        }

        if (!reload) {
            return [];
        }
        // with the relations each row's data wrote, as they were stored, so a caller gets the ids of
        // the rows it references
        const relationsById: Map<string, RelationTree> = new Map(
            entriesWithIds.map(([entry, id]) => [id, this.providedKeyRelations(entry)])
        );
        // as the write left them rather than read back: in a transaction the rows are held, so reading
        // them again answers exactly this, and a save without one hands back its own write, as a
        // statement returning its rows does
        const writtenRows: Map<string, Record<string, string>> = new Map(
            changes.map(c => [c.id, { ...c.after, id: JsonUtilities.stringify(c.id) }])
        );
        return await this.resolveEntitiesOf(ids, writtenRows, { transaction: valKeyTransaction }, valKeyTransaction, relationsById);
    }

    /**
     * Reads what a save compares the rows it writes against.
     * @param ids - The ids of the rows the save writes.
     * @param valKeyTransaction - The transaction the save writes through, when there is one.
     * @param held - What the transaction read of rows it already holds, if it did.
     * @param uniqueKeys - The keys of the unique values the rows are known to take up before anything
     * is read, which are held along with the rows and read with them.
     * @returns The stored rows, the indexes and uniques the store keeps, and who holds those values.
     */
    private async readStoredForSave(
        ids: string[],
        valKeyTransaction: ValKeyTransaction | undefined,
        held: StoredRead | undefined,
        uniqueKeys: string[]
    ): Promise<StoredRead> {
        // read once the transaction held every one of them, and nobody else writes a held row
        if (valKeyTransaction != undefined && held != undefined && ids.every(id => held.rows.has(id))) {
            return held;
        }
        // held before the stored rows are read rather than as each is written: what a row holds
        // decides which unique values it gives up, and reading it before that would let another writer
        // change it in between. One claim for every row and every value known to be taken up, rather
        // than one per write
        await valKeyTransaction?.claimKeys([...ids.map(id => this.rowKey(id)), ...uniqueKeys]);
        // with the list of what the store keeps and who holds those values, in the same round trip
        return await this.readRowsAlongside(ids, valKeyTransaction, true, uniqueKeys);
    }

    /**
     * Works out which unique values new rows take up under what this version declares, for holding
     * them before anything is read.
     *
     * What the store keeps can differ from that, which the save finds once it has read the list: it
     * holds and reads the values this left out then, as it does for the rows of every other save.
     * @param newFields - The new rows by their id, as the fields they are written with.
     * @param valKeyTransaction - The transaction the save writes through. Without one nothing is held.
     * @returns The keys of their indexes.
     */
    private resolveTakenUniqueKeys(
        newFields: Map<string, Record<string, string>>,
        valKeyTransaction: ValKeyTransaction | undefined
    ): string[] {
        if (valKeyTransaction == undefined) {
            return [];
        }
        const keys: Set<string> = new Set();
        for (const fields of newFields.values()) {
            for (const group of this.uniqueGroups) {
                const values: string | undefined = this.coveredBy(group, fields)
                    ? this.uniqueValuesOf(group.properties, fields)
                    : undefined;
                if (values != undefined) {
                    keys.add(this.uniqueKey(group, values));
                }
            }
        }
        return [...keys];
    }

    /**
     * Refuses rows that break a check the store keeps for the entity.
     *
     * The checks the store lists rather than the ones this version declares, as a write keeps the
     * uniques the store lists: a newer release beside this one may hold the rows to more.
     * @param changes - The rows as they were stored and as they will be.
     * @param checks - The checks the store lists.
     * @throws CheckConstraintViolationError naming the first check a row breaks.
     */
    private validateChecks(changes: StoredRowChange[], checks: KeyWhere[] | undefined): void {
        if (!checks?.length) {
            return;
        }
        for (const { after } of changes) {
            const broken: KeyWhere | undefined = after == undefined ? undefined : this.findBrokenCheck(after, checks);
            if (broken != undefined) {
                throw new CheckConstraintViolationError(this.entityClass, broken);
            }
        }
    }

    /**
     * Finds the first of the given checks a row breaks.
     * @param fields - The row, as the json encoded fields it is stored as.
     * @param checks - The checks.
     * @returns The check, or undefined when the row follows all of them.
     */
    private findBrokenCheck(fields: Record<string, string>, checks: KeyWhere[]): KeyWhere | undefined {
        const entity: T = this.fromFields(fields);
        return checks.find(check => !this.evaluator.matches<BaseEntity>(entity, check, this.entityClass));
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
     * @param holders - Who holds the unique values the save already held and read, by their key.
     * @returns True when the writes are applied or buffered, false when a save without a transaction
     * wrote nothing because a transaction holds one of its rows.
     * @throws When another row already holds the values one of the uniques names.
     * @throws CheckConstraintViolationError when a row breaks a check the store keeps.
     * @throws KeyDeclarationsChangedError when the list kept changing under a save without a transaction.
     */
    private async saveWithKeys(
        writes: ValKeyBufferedWrite[],
        changes: StoredRowChange[],
        keys: StoredKeys,
        transaction: ValKeyTransaction | undefined,
        holders: Map<string, string[]> = new Map()
    ): Promise<boolean> {
        if (transaction) {
            // before anything is written; the guard below refuses the commit should the list change
            this.validateChecks(changes, keys.checks);
            transaction.guardKey(this.keysKey(), keys.stored);
            await this.writeAll([...writes, ...this.resolveIndexWrites(changes, keys.indexes)], transaction);
            await this.saveUniqueIndexes(changes, keys.uniques, transaction, holders);
            return true;
        }
        let current: StoredKeys = keys;
        for (let attempt: number = 1; attempt <= KEY_CHANGE_ATTEMPTS; attempt++) {
            if (current.uniques.length) {
                // a newer version started keeping a unique meanwhile, which only a transaction can
                await this.inTransaction(undefined, async own => {
                    await this.saveWithKeys(writes, changes, await this.readStoredKeys(), own);
                });
                return true;
            }
            // judged by the list each attempt is applied against, so a check listed meanwhile holds
            this.validateChecks(changes, current.checks);
            const guarded: ValKeyBufferedWrite[] = [...writes, ...this.resolveIndexWrites(changes, current.indexes)];
            if (await this.writeGuarded(guarded, current)) {
                return true;
            }
            if (await this.isHeldByTransaction(guarded)) {
                return false;
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
        const candidates: Candidates = await this.resolveCandidates(options.where, valKeyTransaction, ROWS_READ_WITH_IDS);
        return await this.findAmong(candidates, options, valKeyTransaction);
    }

    /**
     * Finds the rows among the candidates that a filter matches, in its order, within its window.
     * @param candidates - The rows the filter may match.
     * @param options - The find options.
     * @param valKeyTransaction - The transaction to read through, when there is one.
     * @param keepsFilterRelations - Whether the relations read only for the filter and the order stay
     * on the rows, for a caller that filters them again.
     * @returns The rows.
     */
    private async findAmong(
        candidates: Candidates,
        options: DriverFindOptions<T>,
        valKeyTransaction: ValKeyTransaction | undefined,
        keepsFilterRelations: boolean = false
    ): Promise<T[]> {
        // only what the filter and the order cannot be answered without is read for every row; the
        // rest waits for the rows that are handed back. Reading every relation of every row first
        // read the relations of the whole table for a filter that named none of them
        const resolved: RelationTree = this.relationsToResolve(options);
        const forReading: Set<string> = new Set(this.relationsForReading(options).keys());
        const entities: T[] = await this.resolveEntitiesOf(
            candidates.ids,
            await this.readCandidateRows(candidates.ids, candidates.rows, valKeyTransaction),
            { ...options, relations: new Map([...resolved].filter(([key]) => forReading.has(key))) },
            valKeyTransaction
        );

        const filtered: T[] = options.where
            ? entities.filter(e => this.evaluator.matches(e, options.where as Where<T>, this.entityClass))
            : entities;
        const ordered: T[] = this.applyOrder(filtered, options.order);

        const offset: number = options.offset ?? 0;
        const window: T[] = options.limit == undefined ? ordered.slice(offset) : ordered.slice(offset, offset + options.limit);
        await this.resolveRelationsOf(
            window,
            new Map([...resolved].filter(([key]) => !forReading.has(key))),
            options.related,
            valKeyTransaction
        );
        // after the window rather than before it, so that nothing is taken off a row that is about to
        // be thrown away
        if (!keepsFilterRelations) {
            EntityRelationsUtilities.keepOnlyRequested(window, resolved, EntityRelationsUtilities.resolveTree(options.relations));
        }
        return window;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRelations(
        entities: T[],
        relations: FindAllOptions<T>['relations'],
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined
    ): Promise<T[]> {
        // on the rows as they are held, so only the rows of the relations are read
        await this.resolveRelationsOf(
            entities,
            EntityRelationsUtilities.resolveTree(relations),
            related,
            this.toValKeyTransaction(transaction)
        );
        return entities;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        return (await this.find({ ...options, offset: undefined, limit: 1 })).at(0);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        // one read rather than two. Valkey has no snapshot to hold two reads together in - a
        // transaction here is a set of grants on the rows it writes, which says nothing about what
        // a reader sees - so the closest a page and a total can get to describing one moment is to
        // be taken from the same set of rows. It is also the cheaper of the two: a filtered `count`
        // here is a whole second `find`, and the window was being applied to a set this already had.
        const counting: DriverFindOptions<T> = {
            ...options,
            where: options.totalWhere ?? options.where,
            offset: undefined,
            limit: undefined
        };
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(options.transaction);
        const counted: T[] = await this.findAmong(
            await this.resolveCandidates(counting.where, valKeyTransaction, ROWS_READ_WITH_IDS),
            counting,
            valKeyTransaction,
            true
        );
        // the window is a narrowing of what was just counted, so it is taken out of that rather than
        // read again - which is what keeps the two halves describing the same moment. The relations a
        // filter reaches through are still on the rows here: taken off, a filter through one of them
        // judged every row by a relation that was not there
        const matching: T[] = options.totalWhere == undefined || options.where == undefined
            ? counted
            : counted.filter(e => this.evaluator.matches(e, options.where as Where<T>, this.entityClass));

        const offset: number = options.offset ?? 0;
        const window: T[] = options.limit == undefined ? matching.slice(offset) : matching.slice(offset, offset + options.limit);
        EntityRelationsUtilities.keepOnlyRequested(
            window,
            this.relationsToResolve(counting),
            EntityRelationsUtilities.resolveTree(options.relations)
        );
        return { items: window, totalAmount: counted.length };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(options.transaction);
        // the ids, then the rows a page at a time. There is no cursor to hold here and nothing to
        // gain from one: valkey answers a filter in this process anyway, so what a stream saves is
        // holding every *row* at once, and the id set is the small half. It is read once, so which
        // rows the stream covers is decided when it starts - the same thing a cursor decides. As many
        // rows as a batch holds are read along with the ids
        const candidates: Candidates = await this.resolveCandidates(options.where, valKeyTransaction, STREAM_BATCH_SIZE);
        // as few rows as one batch holds are read once, ordered, and handed out
        if (candidates.ids.length <= STREAM_BATCH_SIZE) {
            yield* await this.findAmong(candidates, options, valKeyTransaction);
            return;
        }
        // more are read twice in an order: once for what it compares, once to hand them out a batch
        // at a time, so that no more than a batch of them is held at once. The rows read along with
        // the ids are the first batch of the first read
        const ids: string[] = options.order == undefined
            ? candidates.ids
            : await this.resolveIdsInOrder(candidates, options, valKeyTransaction);
        const readAlong: RowsReadAlong | undefined = options.order == undefined ? candidates.rows : undefined;
        // without the order, which is decided already, so no row carries a relation it was only ordered by
        const reading: DriverStreamOptions<T> = { ...options, order: undefined };
        const where: Where<T> | undefined = options.where;

        for (let i: number = 0; i < ids.length; i += STREAM_BATCH_SIZE) {
            const batch: string[] = ids.slice(i, i + STREAM_BATCH_SIZE);
            const entities: T[] = await this.resolveEntitiesOf(
                batch,
                await this.readCandidateRows(batch, readAlong, valKeyTransaction),
                reading,
                valKeyTransaction
            );
            const matching: T[] = where ? entities.filter(e => this.evaluator.matches(e, where, this.entityClass)) : entities;
            // nor one it was only filtered by, as a find hands its rows back
            EntityRelationsUtilities.keepOnlyRequested(
                matching,
                this.relationsToResolve(reading),
                EntityRelationsUtilities.resolveTree(options.relations)
            );
            yield* matching;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async count(options: DriverFindOptions<T>): Promise<number> {
        if (!options.where) {
            return (await this.readIds(this.toValKeyTransaction(options.transaction))).length;
        }
        return (await this.find({ where: options.where, related: options.related, transaction: options.transaction })).length;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async aggregate(options: DriverAggregateOptions<T>): Promise<AggregateRow[]> {
        // in this process, from the rows a filter matches, as everything a filter asks is answered here
        const rows: T[] = await this.find({ where: options.where, related: options.related, transaction: options.transaction });
        return AggregateUtilities.resolveRows(rows, options.fn, options.property, options.groupBy);
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
        // held from the read to the write, as updateAll holds them, and written in the one request a
        // save sends whatever each row gives
        return await this.inTransaction(transaction, async valKeyTransaction => {
            const held: HeldRows<T> = await this.holdRowsMatching(where, related, valKeyTransaction);
            const matched: Map<string, T> = new Map(held.entities.map(m => [String(m.id), m]));
            return await this.saveThrough(
                rows.flatMap(r => {
                    const stored: T | undefined = matched.get(String(r.id));
                    return stored == undefined ? [] : [WriteDataUtilities.resolveMerged(r, stored, this.entityClass)];
                }),
                valKeyTransaction,
                true,
                held
            );
        });
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
        const { where, data, increments, related, returnUpdated, returnAtMost }: DriverUpdateAllOptions<T, R> = options;

        const held: HeldRows<T> = await this.holdRowsMatching(where, related, valKeyTransaction);
        const matched: T[] = held.entities;
        if (!matched.length) {
            return (returnUpdated === true ? [] : 0) as R extends true ? T[] : number;
        }
        // judged on the rows read to hold them, which is the count: answering the filter reads them
        if (returnAtMost != undefined && matched.length > returnAtMost) {
            throw new UnboundedReturnError(this.entityClass.name, returnAtMost);
        }

        // the write is what knows which rows it wrote, so it is what hands them back. Reading them
        // again would also have to read them by id rather than by re-running the filter: the update
        // may well have changed a column the filter matches on - updateAll({ status: 'QUEUED' },
        // { status: 'SENT' }) being the obvious case - and re-running it then returns the rows that
        // were *not* touched
        // merged into what each row holds as it is read once held, so nothing writes it in between -
        // which is also what makes an amount added here land on top of any other writer's
        const updated: T[] = await this.saveThrough(
            matched.map(m => ({
                ...WriteDataUtilities.resolveIncremented(WriteDataUtilities.resolveMerged(data, m, this.entityClass), m, increments),
                id: m.id
            })),
            valKeyTransaction,
            returnUpdated === true,
            held
        );
        return (returnUpdated === true ? updated : matched.length) as R extends true ? T[] : number;
    }

    /**
     * Takes hold of every row a filter matches, and reads them as they stand once held.
     * @param where - The filter selecting the rows.
     * @param related - What the rows of each entity the filter reaches through a relation are narrowed to.
     * @param valKeyTransaction - The transaction the rows are held in.
     * @returns The rows, as they are now that nobody else can write them, and what a save of them
     * compares them against.
     */
    private async holdRowsMatching(
        where: Where<T> | undefined,
        related: RelatedNarrowing | undefined,
        valKeyTransaction: ValKeyTransaction
    ): Promise<HeldRows<T>> {
        // an id is the one thing a filter can say that a write cannot make untrue: a row either
        // exists or it does not, and the id of one never changes. So the rows it names can be held
        // straight away and read once, where a filter saying anything else has to be evaluated
        // again afterwards
        const named: string[] | undefined = this.idsNamedBy(where);
        if (named) {
            await this.claimRows(named, valKeyTransaction);
            return await this.readHeldRows(named, { transaction: valKeyTransaction }, valKeyTransaction);
        }

        // a filter pinning the ids and asking more besides matches none of the rows outside them, so
        // those are held without reading anything first. Any other filter is read while holding
        // nothing, because it cannot name its rows until it has read them, and nothing is trusted from
        // that read except which rows to hold
        const pinned: string[] | undefined = this.idsFromFilter(where);
        const candidates: string[] = pinned == undefined
            ? (await this.find({ where, related, transaction: valKeyTransaction })).map(c => c.id)
            // once each, which a filter naming an id in two of its branches does not
            : [...new Set(pinned)];
        if (!candidates.length) {
            return { entities: [], rows: new Map(), keys: { uniques: [], indexes: [], stored: '' }, holders: new Map() };
        }
        await this.claimRows(candidates, valKeyTransaction);

        // read again now that the rows are held, and this is the read that counts. One of them may
        // have been changed by a single row write while this was queueing for it, and a row that
        // stopped matching by then is dropped - which is what a database does once it has been
        // granted a row lock. By their ids, since a row that started matching meanwhile is not held
        const options: DriverFindOptions<T> = { where, related, transaction: valKeyTransaction };
        const held: HeldRows<T> = await this.readHeldRows(candidates, options, valKeyTransaction);
        const matching: T[] = held.entities.filter(e => where == undefined || this.evaluator.matches(e, where, this.entityClass));
        // as a find hands them back, without what was only read to judge the filter
        EntityRelationsUtilities.keepOnlyRequested(
            matching,
            this.relationsToResolve(options),
            EntityRelationsUtilities.resolveTree(undefined)
        );
        return { ...held, entities: matching };
    }

    /**
     * Reads rows the transaction holds together with the indexes and uniques the store keeps, which
     * is everything the save writing them would read again.
     * @param ids - The ids of the rows.
     * @param options - The find options, used to determine which relations need to be resolved.
     * @param valKeyTransaction - The transaction holding the rows.
     * @returns The rows, and what a save of them compares them against.
     */
    private async readHeldRows(ids: string[], options: DriverFindOptions<T>, valKeyTransaction: ValKeyTransaction): Promise<HeldRows<T>> {
        const read: StoredRead = await this.readRowsAlongside(ids, valKeyTransaction, true);
        return { ...read, entities: await this.resolveEntitiesOf(ids, read.rows, options, valKeyTransaction) };
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
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        const pending: PendingUpsert<T>[] = rows.map(row => ({
            create: row.create,
            changes: ObjectUtilities
                .entries(row.onConflict as Record<string, UpsertChange | undefined>)
                .filter((entry): entry is [string, UpsertChange] => entry[1] != undefined),
            // the rows an identity may land on are the ones the key covers, which is not every row
            // holding the identity's values: a key over part of a table leaves the rest free
            conflictWhere: UpsertIdentityUtilities.resolveConflictWhere(this.entityClass, identity, row.create),
            where: row.where
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

            // the rows that may hold an identity: the ones the key's index names where it answers for
            // all of them, or else the ones reading every row finds holding one. Nothing is trusted
            // from either except which rows to hold
            const branches: WhereFilter<T>[] = pending.flatMap(p => Array.isArray(p.conflictWhere) ? p.conflictWhere : [p.conflictWhere]);
            const toHold: string[] = [
                ...new Set((await this.candidatesFromUniqueFilter(branches, valKeyTransaction, undefined))?.ids
                    ?? this.resolveIdentityHolders(identity, pending, await this.find({ transaction: valKeyTransaction })).values())
            ];

            // a row can only be held once it is known, so its grant is taken after the look above - and
            // a plain write may have been holding one, and committing, the whole time that look was
            // happening. Reading again once they are held is what makes the value this adds to the
            // value that is actually stored, rather than the one that was stored a moment ago. With
            // whatever relations `reachable` and the rows' own conditions need, so each row can be
            // judged by them right here rather than read a second time through a filter
            await this.claimRows(toHold, valKeyTransaction);
            const judgedBy: WhereFilter<T>[] = [reachable, ...pending.map(p => p.where)]
                .flatMap(w => w == undefined ? [] : Array.isArray(w) ? w : [w]);
            const heldRows: HeldRows<T> = await this.readHeldRows(
                toHold,
                { where: judgedBy.length ? judgedBy : undefined, related },
                valKeyTransaction
            );
            const held: Map<string, T> = new Map(heldRows.entities.map(e => [e.id, e]));
            // which row holds each identity is judged on the held rows too, since a row may have given
            // its values up while it was not held yet
            const foundIds: Map<PendingUpsert<T>, string> = this.resolveIdentityHolders(identity, pending, heldRows.entities);

            const data: DeepPartial<T>[] = pending.map(p => {
                const id: string | undefined = foundIds.get(p);
                const existing: T | undefined = id == undefined ? undefined : held.get(id);
                if (existing == undefined) {
                    return p.create;
                }
                // judged while the row's grant is held, so what decides it is what the write lands on
                if (
                    (reachable != undefined && !this.evaluator.matches(existing, reachable, this.entityClass))
                    || (p.where != undefined && !this.evaluator.matches(existing, p.where, this.entityClass))
                ) {
                    const group: UniqueGroup = UpsertIdentityUtilities.resolveUniqueGroup(this.entityClass, identity);
                    throw new UniqueConstraintViolationError(this.entityClass.name, group.properties);
                }
                const updated: Record<string, unknown> = { id: existing.id };
                for (const [key, change] of p.changes) {
                    // null or missing counts as 0, as it does for an update's increments
                    const stored: unknown = (existing as Record<string, unknown>)[key];
                    updated[key] = 'increment' in change
                        ? (stored == undefined ? 0 : Number(stored)) + change.increment
                        : change.set;
                }
                return updated as DeepPartial<T>;
            });
            // one save for every row, which hands them back in the order they were given
            return await this.saveThrough(data, valKeyTransaction, true, heldRows);
        });
    }

    /**
     * Finds the row holding the identity of each pending upsert among the given rows.
     *
     * Each pending row is paired with the rows holding its own values and judged by its own filter
     * alone: judging every row read against the filter of every identity, as one filter of all of
     * them, was the square of the batch.
     * @param identity - The properties identifying a row.
     * @param pending - The pending upserts.
     * @param rows - The rows to look among.
     * @returns The id of the row holding each one's identity, for those a row holds.
     */
    private resolveIdentityHolders(identity: string[], pending: PendingUpsert<T>[], rows: T[]): Map<PendingUpsert<T>, string> {
        const byValues: Map<string, T[]> = new Map();
        for (const row of rows) {
            const values: string = UpsertIdentityUtilities.resolveValues(identity, row);
            byValues.set(values, [...byValues.get(values) ?? [], row]);
        }
        const res: Map<PendingUpsert<T>, string> = new Map();
        for (const p of pending) {
            const holder: T | undefined = byValues.get(UpsertIdentityUtilities.resolveValues(identity, p.create))
                ?.find(c => this.evaluator.matches(c, p.conflictWhere, this.entityClass));
            if (holder != undefined) {
                res.set(p, holder.id);
            }
        }
        return res;
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
    async remove(ids: string[], reach: RemovalReach<T> | undefined, transaction: Transaction | undefined): Promise<string[]> {
        if (!ids.length) {
            return [];
        }
        // judged on the rows as the removal reads them anyway, so a reach costs no round trip. A
        // filter through a relation is judged on the related rows, which only a read resolves: those
        // are held from the read to the removal, as an update holds its rows
        if (reach == undefined || !this.reachesThroughRelation(reach.where)) {
            return await this.removeByIds(ids, this.toValKeyTransaction(transaction), reach);
        }
        return await this.inTransaction(transaction, async valKeyTransaction => {
            const wanted: Set<string> = new Set(ids);
            const within: string[] = (await this.holdRowsMatching(reach.where, reach.related, valKeyTransaction)).entities
                .map(row => String(row.id))
                .filter(id => wanted.has(id));
            if (reach.wholly && within.length < ids.length) {
                return [];
            }
            return await this.removeByIds(within, valKeyTransaction, undefined);
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeMatching(
        where: Where<T> | undefined,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined
    ): Promise<string[]> {
        const reach: RemovalReach<T> | undefined = where == undefined ? undefined : { where, related, wholly: false };
        // through a relation, the filter is judged on the related rows, which only a find resolves
        if (where != undefined && this.reachesThroughRelation(where)) {
            return await this.remove(await this.findIds({ where, related, transaction }), reach, transaction);
        }
        // otherwise on the rows the removal reads anyway for what they hold in the indexes, with the
        // list of those in the same round trip: finding them first would read them twice
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(transaction);
        const { ids }: Candidates = await this.resolveCandidates(where, valKeyTransaction, undefined);
        return await this.removeByIds([...new Set(ids)], valKeyTransaction, reach);
    }

    /**
     * Whether a filter asks anything of the rows an entity's relations hold.
     * @param where - The filter.
     * @returns True when one of its conditions names a relation.
     */
    private reachesThroughRelation(where: Where<T>): boolean {
        const branches: WhereFilter<T>[] = Array.isArray(where) ? where : [where];
        return branches.some(branch => Object.keys(branch).some(key => this.isRelation(this.properties[key])));
    }

    /**
     * Removes the rows with the given ids that are within a reach, with what they hold in the indexes
     * and uniques.
     *
     * The reach is judged on each row as it is read for the removal, which reads every row anyway for
     * what it holds in the indexes. Inside a transaction the rows are held from that read on. Outside
     * one, the write is guarded on the rows as they were read, so a row written in between - moved out
     * of the reach, or holding other values in an index by now - is read and judged again rather than
     * removed as it was.
     * @param ids - The ids of the rows to remove.
     * @param valKeyTransaction - The transaction to run the operation in, if any.
     * @param reach - What a row has to match to be removed, and whether the rows go wholly, or
     * undefined for every row that is stored.
     * @returns The ids of the rows that were stored and within the reach, and are removed.
     * @throws KeyDeclarationsChangedError when the indexes and uniques kept changing, and a
     * ConflictError when the rows did.
     */
    private async removeByIds(
        ids: string[],
        valKeyTransaction: ValKeyTransaction | undefined,
        reach: RemovalReach<T> | undefined
    ): Promise<string[]> {
        if (!ids.length) {
            return [];
        }
        if (valKeyTransaction) {
            // one claim for every row, rather than one per delete, and before the read that judges them
            await valKeyTransaction.claimKeys(ids.map(id => this.rowKey(id)));
            const [stored, keys]: [Map<string, Record<string, string>>, StoredKeys] = await this.readRowsAndKeys(ids, valKeyTransaction);
            const removing: string[] = this.resolveRowsWithinReach(ids, stored, reach);
            if (!removing.length) {
                return [];
            }
            valKeyTransaction.guardKey(this.keysKey(), keys.stored);
            await this.writeAll(await this.resolveRemovalWrites(removing, stored, keys, valKeyTransaction), valKeyTransaction);
            return removing;
        }

        let keysBefore: string | undefined;
        for (let attempt: number = 1; attempt <= KEY_CHANGE_ATTEMPTS; attempt++) {
            const [stored, keys]: [Map<string, Record<string, string>>, StoredKeys] = await this.readRowsAndKeys(ids, undefined);
            // the keys are retried over, as a save retries over them, where a row written under
            // every attempt is contention this will not wait out
            if (keysBefore != undefined && keysBefore === keys.stored) {
                throw new ConflictError($ts`A row to delete was written while it was being deleted. Run the delete again.`);
            }
            keysBefore = keys.stored;
            const removing: string[] = this.resolveRowsWithinReach(ids, stored, reach);
            if (!removing.length) {
                return [];
            }
            const writes: ValKeyBufferedWrite[] = await this.resolveRemovalWrites(removing, stored, keys, undefined);
            const rows: Map<string, Record<string, string>> = new Map(removing.map(id => [this.rowKey(id), stored.get(id) ?? {}]));
            if (await this.writeGuarded(writes, keys, rows)) {
                return removing;
            }
            if (await this.isHeldByTransaction(writes)) {
                // waited for in a transaction of its own, which holds the rows before it reads them,
                // as one holding a row it changed would apply that change over the removal when it
                // commits (round-2/11 S14)
                return await this.inTransaction(undefined, async own => await this.removeByIds(ids, own, reach));
            }
        }
        throw new KeyDeclarationsChangedError();
    }

    /**
     * The rows among the given ids that are stored and within a reach, as they were read.
     * @param ids - The ids of the rows to remove.
     * @param stored - The rows by id, as they are stored.
     * @param reach - What a row has to match, and whether the rows go wholly, or undefined for every
     * stored row.
     * @returns The ids of the rows to remove: none of them when they go wholly and one is gone or
     * out of reach.
     */
    private resolveRowsWithinReach(
        ids: string[],
        stored: Map<string, Record<string, string>>,
        reach: RemovalReach<T> | undefined
    ): string[] {
        const within: string[] = ids.filter(id => {
            const fields: Record<string, string> | undefined = stored.get(id);
            return fields != undefined
                && (reach == undefined || this.evaluator.matches(this.fromFields(fields), reach.where, this.entityClass));
        });
        return reach?.wholly === true && within.length < ids.length ? [] : within;
    }

    /**
     * The writes that remove the given rows: the rows, their sides of many to many relations, their
     * ids, and what they hold in the indexes and uniques.
     *
     * The values a row gives up in its indexes are read off the row as it is stored, which is the
     * only form that names the entries: an encrypted value never encrypts to the same text twice.
     * @param ids - The ids of the rows.
     * @param stored - The rows by id, as they are stored.
     * @param keys - The indexes and uniques the store keeps.
     * @param valKeyTransaction - The transaction the removal runs in, if any, which holds the values
     * given up until it ends.
     * @returns The writes.
     */
    private async resolveRemovalWrites(
        ids: string[],
        stored: Map<string, Record<string, string>>,
        keys: StoredKeys,
        valKeyTransaction: ValKeyTransaction | undefined
    ): Promise<ValKeyBufferedWrite[]> {
        // every write of every row in one go: nothing has to happen in order, since each row knows its
        // own id and the one key they share - the id set - only ever has members removed from it
        const writes: ValKeyBufferedWrite[] = await this.resolveManyToManyRemovals(ids, valKeyTransaction);
        writes.push(...ids.map((id): ValKeyBufferedWrite => ({ type: 'delete', key: this.rowKey(id) })));
        writes.push({ type: 'setRemove', key: this.idsKey(), members: ids });
        const uniqueRemovals: ValKeyBufferedWrite[] = ids.flatMap(id => this.resolveUniqueIndexRemovals(id, stored.get(id), keys.uniques));
        // inside a transaction, the values are only free once it commits: held until then, for the
        // reason a save holds the values it gives up. Given up outside one, a value is applied at
        // once, so nothing is held
        await valKeyTransaction?.claimKeys(uniqueRemovals.map(w => w.key));
        return [
            ...writes,
            ...uniqueRemovals,
            ...this.resolveIndexWrites(ids.map(id => ({ id, before: stored.get(id), after: undefined })), keys.indexes)
        ];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIds(options: DriverFindOptions<T>): Promise<string[]> {
        // through `find`, since a row is only judged by a filter once it is read: what this saves a
        // valkey caller is the rows being handed up and held, not the reading of them
        return (await this.find(options)).map(e => e.id);
    }

    /**
     * Points every unique declaration the written rows satisfy at them, and stops pointing the values
     * they no longer have.
     *
     * Taking a value up does not commute - that is the whole of what unique means - so it is claimed
     * and checked first. A value given up is claimed as well, and held until the transaction ends: a
     * write taking it up meanwhile waits to see whether the row lets go of it, rather than being
     * refused over a value that is about to be free.
     *
     * Every row stored before a unique was kept is indexed under it by the boot that starts keeping
     * it, before anything reads it.
     * @param rows - The rows as they were stored and as they are stored now. Their fields are taken
     * rather than recomputed, so that a default filled in for a new row is indexed under the value that
     * was actually stored.
     * @param uniques - The uniques the store keeps.
     * @param transaction - The transaction to write through. Always present when there is anything
     * to index, because a save takes a transaction of its own whenever the store keeps a unique.
     * @param held - Who holds the unique values the save already held and read, by their key.
     * @throws When another row already holds the values one of the declarations names.
     */
    private async saveUniqueIndexes(
        rows: StoredRowChange[],
        uniques: UniqueGroup[],
        transaction: ValKeyTransaction | undefined,
        held: Map<string, string[]> = new Map()
    ): Promise<void> {
        const changes: UniqueIndexChange[] = this.resolveUniqueIndexChanges(rows, uniques);

        // the grants before the read, for the reason an upsert's come first: an index cannot say who
        // holds a value until it has been read, and a grant taken afterwards would leave that answer
        // already stale. Holding them until the transaction ends is what makes the check and the
        // write following it one step as far as every other writer is concerned - two instances
        // inserting the same value at the same time is exactly the case this covers, and neither of
        // them has a row to hold instead. All of them in one claim and one read
        const takenKeys: string[] = [...new Set(changes.flatMap(c => c.next == undefined ? [] : [this.uniqueKey(c.group, c.next)]))];
        // the removal of a value given up is buffered until the commit, so a write taking it up in
        // the meantime would still read this row holding it and be refused - where postgres has it
        // wait for the outcome. Held, it waits too, and reads the value free once this commits.
        // In the same claim, so that every key is taken in one sorted order
        const givenUpKeys: string[] = changes.flatMap(c => c.previous == undefined ? [] : [this.uniqueKey(c.group, c.previous)]);
        // a key the save held before reading the rows is held already, and claims nothing again
        await transaction?.claimKeys([...takenKeys, ...givenUpKeys]);
        // as stored, without this transaction's writes: those are laid over it change by change below.
        // Only the ones the save did not read along with the rows, after holding them
        const unread: string[] = takenKeys.filter(key => !held.has(key));
        const holders: string[][] = await this.readSets(unread, undefined);
        const storedHolders: Map<string, string[]> = new Map([
            ...held,
            ...unread.map((key, i): [string, string[]] => [key, holders[i] ?? []])
        ]);

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
     * Removes every key of this entity, for a migration removing it: its rows and their ids, the many
     * to many relations they hold from both sides, and what is kept about its indexes and uniques.
     * @param transaction - The transaction of the migration.
     */
    async removeStoredKeys(transaction: Transaction): Promise<void> {
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(transaction);
        if (!valKeyTransaction) {
            throw new InternalError('Entities are removed in the migration\'s transaction.');
        }
        const prefix: string = `${this.keyPrefix}:${this.tableName}:`;
        const ids: string[] = await this.readIds(valKeyTransaction);
        const writes: ValKeyBufferedWrite[] = [];
        const deleted: Set<string> = new Set([
            ...await scanValKeyKeys(this.client, `${prefix}*`),
            // with the ones only the transaction holds so far, which no scan finds
            this.idsKey(),
            ...ids.map(id => this.rowKey(id))
        ]);
        for (const [key, metadata] of ObjectUtilities.entries(this.properties)) {
            if (metadata.type !== Relation.MANY_TO_MANY) {
                continue;
            }
            const joinKeys: string[] = ids.map(id => this.joinKey(id, key));
            const related: string[][] = await this.readSets(joinKeys, valKeyTransaction);
            for (const joinKey of joinKeys) {
                deleted.add(joinKey);
            }
            // moving none of the rows anywhere, which takes each of them off the other side
            writes.push(...this.resolveMovedRelationWrites(
                key,
                metadata.target(),
                metadata.inverseSide,
                ids.map((id, i): [string, string[]] => [id, related[i] ?? []]),
                new Map()
            ));
        }
        // kept, so that an entity stored under this name again hands out no number it handed out before
        deleted.delete(`${prefix}sequence`);

        await this.writeAll([...[...deleted].map((key): ValKeyBufferedWrite => ({ type: 'delete', key })), ...writes], valKeyTransaction);
    }

    /**
     * Removes the sets a many to many relation keeps for every row of this entity, for a migration
     * removing the relation.
     * @param propertyKey - The relation's property on this entity.
     * @param transaction - The transaction of the migration.
     */
    async removeJoinSets(propertyKey: string, transaction: Transaction): Promise<void> {
        const valKeyTransaction: ValKeyTransaction | undefined = this.toValKeyTransaction(transaction);
        if (!valKeyTransaction) {
            throw new InternalError('Relations are removed in the migration\'s transaction.');
        }
        const ids: string[] = await this.readIds(valKeyTransaction);
        await this.writeAll(
            ids.map((id): ValKeyBufferedWrite => ({ type: 'delete', key: this.joinKey(id, propertyKey) })),
            valKeyTransaction
        );
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
     *
     * A check is listed the same way, so that every write from then on is held to it, and then
     * judged against the rows stored before.
     * @returns Whether a declaration or a check was added or removed.
     * @throws When stored rows break a unique or a check the entity declares. That one is taken off the
     * list again, so nothing enforces or reads it.
     */
    async reconcileStoredKeys(): Promise<boolean> {
        const stored: StoredKeys = await this.readStoredKeys();
        // the checks only when there are some, so the list of an entity declaring none reads as it did
        // before checks were kept
        const declared: KeyLists = {
            uniques: this.uniqueGroups,
            indexes: this.indexGroups,
            ...this.checks.length ? { checks: this.checks } : {}
        };
        const declaredText: string = JsonUtilities.stringify(declared);
        const storedDeclarations: Map<string, KeyDeclaration> = this.resolveKeyDeclarations(stored);
        const declaredDeclarations: KeyDeclaration[] = [...this.resolveKeyDeclarations(declared).values()];
        const added: KeyDeclaration[] = declaredDeclarations.filter(d => !storedDeclarations.has(d.identity));
        const removed: KeyDeclaration[] = [...storedDeclarations.values()]
            .filter(s => !declaredDeclarations.some(d => d.identity === s.identity));
        const storedChecks: Set<string> = new Set((stored.checks ?? []).map(c => this.checkIdentity(c)));
        const declaredChecks: Set<string> = new Set(this.checks.map(c => this.checkIdentity(c)));
        const checksChanged: boolean = storedChecks.size !== declaredChecks.size || [...declaredChecks].some(c => !storedChecks.has(c));
        const [built = []]: string[][] = await this.readSets([this.builtKey()], undefined);
        // with the ones listed and never built, which a boot that failed half way leaves behind
        const unbuilt: KeyDeclaration[] = declaredDeclarations.filter(d => added.includes(d) || !built.includes(d.identity));
        const unjudged: KeyWhere[] = this.checks.filter(c => !built.includes(this.checkIdentity(c)));
        if (stored.stored === declaredText && !unbuilt.length && !unjudged.length) {
            return false;
        }

        // whatever keys an added declaration has were left by nobody keeping them, since no list
        // named it - and an entry nobody keeps would be read as one somebody does
        await this.deleteKeysOf(added);
        // a check taken off is no longer built, so declaring it again judges the rows again
        const removedChecks: string[] = [...storedChecks].filter(c => !declaredChecks.has(c));
        await this.replaceStoredKeys(declaredText, [...[...added, ...removed].map(d => d.identity), ...removedChecks]);
        // after the list rather than before it, so that no write is still adding to them: one that
        // read the old list is refused when it is applied, and reads the new one
        await this.deleteKeysOf(removed);
        await this.buildKeys(unbuilt, declared);
        await this.judgeStoredRows(unjudged, declared);
        return added.length > 0 || removed.length > 0 || checksChanged;
    }

    /**
     * Builds the ids, indexes and uniques the store keeps for the entity again from the rows it stores,
     * whatever was kept before.
     *
     * For after a restore, which brings back keys that need not agree with each other: a row whose id
     * is not listed, or an entry naming a row that is not there. Run while it holds the schema lock.
     * @returns Whether the restored list named other indexes, uniques or checks than the entity declares.
     * @throws When stored rows break a unique or a check the entity declares. That one is taken off the
     * list again, so nothing enforces or reads it.
     */
    async rebuildStoredKeys(): Promise<boolean> {
        await this.rebuildIds();
        const stored: StoredKeys = await this.readStoredKeys();
        const declared: KeyLists = {
            uniques: this.uniqueGroups,
            indexes: this.indexGroups,
            ...this.checks.length ? { checks: this.checks } : {}
        };
        const declarations: KeyDeclaration[] = [...this.resolveKeyDeclarations(declared).values()];
        const storedDeclarations: Map<string, KeyDeclaration> = this.resolveKeyDeclarations(stored);
        const storedChecks: Set<string> = new Set((stored.checks ?? []).map(c => this.checkIdentity(c)));
        const declaredChecks: Set<string> = new Set(this.checks.map(c => this.checkIdentity(c)));
        const differs: boolean = storedDeclarations.size !== declarations.length
            || declarations.some(d => !storedDeclarations.has(d.identity))
            || storedChecks.size !== declaredChecks.size
            || [...declaredChecks].some(c => !storedChecks.has(c));
        // what the restored list names as well as what the entity declares: an entry of either can name
        // a row that is not there
        const kept: KeyDeclaration[] = [...new Map([...storedDeclarations.values(), ...declarations].map(d => [d.identity, d])).values()];
        // taken off the built ones first, so that no filter is answered from them while they are rebuilt
        await this.replaceStoredKeys(JsonUtilities.stringify(declared), [
            ...kept.map(d => d.identity),
            ...this.checks.map(c => this.checkIdentity(c))
        ]);
        await this.deleteKeysOf(kept);
        await this.buildKeys(declarations, declared);
        await this.judgeStoredRows(this.checks, declared);
        return differs;
    }

    /**
     * Lists the ids of exactly the rows stored, in place of the list kept before.
     */
    private async rebuildIds(): Promise<void> {
        const rowKeyPrefix: string = this.rowKey('');
        // a row is a hash right under the table: everything else kept there is no hash, or is one
        // level further down
        const ids: string[] = (await scanValKeyKeys(this.client, `${rowKeyPrefix}*`, valKeyGlide().ObjectType.HASH))
            .map(key => key.slice(rowKeyPrefix.length))
            .filter(id => !id.includes(':'));
        const batch: Batch = new (valKeyGlide().Batch)(true);
        batch.del([this.idsKey()]);
        for (const chunk of PromiseUtilities.resolveChunks(ids, STREAM_BATCH_SIZE)) {
            // eslint-disable-next-line cspell/spellchecker
            batch.sadd(this.idsKey(), chunk);
        }
        await this.client.exec(batch, true);
    }

    /**
     * Judges every stored row by the given checks, and names each of them built once every row follows it.
     *
     * The checks are on the list already, so a row written meanwhile was held to them by its writer.
     * @param checks - The checks to judge the rows by.
     * @param declared - Everything the entity declares, which a check the rows break is taken out of.
     * @throws When a stored row breaks one of the checks, naming the row.
     */
    private async judgeStoredRows(checks: KeyWhere[], declared: KeyLists): Promise<void> {
        if (!checks.length) {
            return;
        }
        // a batch of rows at a time, as building does
        for (const ids of PromiseUtilities.resolveChunks(await this.readIds(undefined), STREAM_BATCH_SIZE)) {
            for (const [id, fields] of await this.readRows(ids, undefined)) {
                const broken: KeyWhere | undefined = this.findBrokenCheck(fields, checks);
                if (broken == undefined) {
                    continue;
                }
                // so that nothing enforces a check the stored rows already break
                const brokenIdentity: string = this.checkIdentity(broken);
                const kept: KeyWhere[] = (declared.checks ?? []).filter(c => this.checkIdentity(c) !== brokenIdentity);
                await this.replaceStoredKeys(
                    JsonUtilities.stringify({
                        uniques: declared.uniques,
                        indexes: declared.indexes,
                        ...kept.length ? { checks: kept } : {}
                    }),
                    []
                );
                const properties: string = CheckConstraintViolationError.resolveProperties(broken).join(', ');
                throw new InternalError([
                    `Cannot hold ${this.entityClass.name} to the check on ${properties}:`,
                    `the stored row ${id} breaks it.`,
                    'Change the rows breaking it in a migration.'
                ]);
            }
        }
        await this.writeAll([{ type: 'setAdd', key: this.builtKey(), members: checks.map(c => this.checkIdentity(c)) }], undefined);
    }

    /**
     * Names a check the way the set of the built ones names it.
     * @param check - The check.
     * @returns `check:` and a short hash of the filter.
     */
    private checkIdentity(check: KeyWhere): string {
        const hash: string = createHash('sha256')
            .update(JsonUtilities.stringify(check))
            .digest('hex')
            .slice(0, 8);
        return `check:${hash}`;
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
            ...declared,
            uniques: declared.uniques.filter(u => !brokenIdentities.has(this.uniqueIdentity(u)))
        };
        await this.replaceStoredKeys(JsonUtilities.stringify(kept), broken.map(d => d.identity));
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
     * @param unbuilt - The identities of the declarations and checks that are not built from now on.
     */
    private async replaceStoredKeys(stored: string, unbuilt: string[]): Promise<void> {
        const batch: Batch = new (valKeyGlide().Batch)(true);
        batch.set(this.keysKey(), stored);
        if (unbuilt.length) {
            batch.srem(this.builtKey(), unbuilt);
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
     *
     * An index answers a lookup by any leading part of itself, and a unique over every row is kept by
     * one over its columns in the order they are written. An entry here is the whole combination of a
     * group's values, so every leading part of each is kept as a group of its own - which is what lets
     * an entity declare (tenantId, status) and nothing on tenantId alone, as it does on a sql store.
     * @param indexes - The declarations, a property carrying `index` being a group of one.
     * @param uniques - The unique declarations, whose leading parts are answered the same way.
     * @returns The groups, each sorted, without duplicates and without a group naming an encrypted or
     * hashed property, the longest first so a filter is answered from the one that names most of it.
     */
    private resolveIndexGroups(indexes: string[][], uniques: UniqueGroup[]): string[][] {
        const seen: Set<string> = new Set();
        const leadingParts: (group: string[], length: number) => string[][] = (group, length) => Array
            .from({ length }, (_, i) => group.slice(0, i + 1));
        return [
            ...indexes.flatMap(group => leadingParts(group, group.length)),
            // the whole group is answered through the unique's own entries
            ...uniques.filter(group => coversEveryRow(group.where))
                .flatMap(group => leadingParts(group.properties, group.properties.length - 1))
        ]
            .sort((a, b) => b.length - a.length)
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
     * Resolves the candidates of a filter whose every branch names every property of a built index
     * with plain values.
     *
     * The rows read are still judged by the whole filter, so an entry that no longer holds costs a
     * read and never a wrong answer.
     * @param where - The where filter of the query.
     * @param transaction - The transaction to read through.
     * @param readAlong - How many rows to read along with their ids at most, or undefined to read none.
     * @returns The candidates, or undefined when a branch names no index or an index it names is not
     * built yet.
     */
    private async candidatesFromIndexFilter(
        where: DriverFindOptions<T>['where'],
        transaction: ValKeyTransaction | undefined,
        readAlong: number | undefined
    ): Promise<Candidates | undefined> {
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
        const read: SetsWithRows = await this.readSetsWithRows([this.builtKey(), ...entryKeys], 1, transaction, readAlong);
        const [built = [], ...entries]: string[][] = read.members;
        if ([...named].some(identity => !built.includes(identity))) {
            return undefined;
        }
        return { ids: [...new Set(entries.flat())], rows: read.rows };
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
        return value != undefined && (typeof value !== 'object' || value instanceof Date || value instanceof BigNumber);
    }

    // encoded the way a write encodes the value into its field, so the entry a filter names is the one
    // the row was put under
    private encodeFilterValue(key: string, value: unknown): string {
        const metadata: PropertyMetadata | undefined = this.properties[key];
        if (metadata == undefined) {
            return JsonUtilities.stringify(toJsonValue(value));
        }
        // 11 §S6: an exact decimal may be named by any number equal to it, and a write stores it as the
        // decimal it is: `10` names the entry of `BigNumber(10)` only once it is one
        const declared: unknown = metadata.type === 'number' && metadata.format === 'bignumber'
            && (typeof value === 'number' || typeof value === 'bigint')
            ? NumberUtilities.new(value)
            : value;
        return JsonUtilities.stringify(this.toStorableValue(declared, metadata));
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
     * Turns rows into entities, and resolves the relations the find options ask for on them.
     * @param ids - The ids of the rows, in the order the entities are handed back.
     * @param rows - The rows by their id, as the json encoded fields they are stored as.
     * @param options - The find options, used to determine which relations need to be resolved.
     * @param transaction - The transaction to read the relations through.
     * @param relationsById - The relations to resolve on a row in place of the ones the options name,
     * by the id of the row.
     * @returns The entities, in the order of the ids, skipping ids that hold no row.
     */
    private async resolveEntitiesOf(
        ids: string[],
        rows: Map<string, Record<string, string>>,
        options: DriverFindOptions<T>,
        transaction: ValKeyTransaction | undefined,
        relationsById?: RelationTreeByRowId
    ): Promise<T[]> {
        const relationsToResolve: RelationTree = this.relationsToResolve(options);
        const entities: T[] = ids.flatMap(id => {
            const row: Record<string, string> | undefined = rows.get(id);
            return row == undefined ? [] : [this.fromFields(row)];
        });

        if (relationsById == undefined) {
            await this.resolveRelationsOf(entities, relationsToResolve, options.related, transaction);
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
        await Promise.all([...groups.values()].map(
            async g => await this.resolveRelationsOf(g.entities, g.relations, options.related, transaction)
        ));
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
        return EntityRelationsUtilities.mergeTrees(EntityOrderUtilities.resolveRelations(options.order, this.entityClass), forFilter);
    }

    /**
     * Resolves relations on many rows at once: one read per relation for all of them, rather than one
     * per row, each narrowed to the rows the caller may see.
     * @param entities - The rows, changed in place.
     * @param relations - The relations to resolve, and those to resolve below each of them.
     * @param related - What the rows each relation reaches are narrowed to.
     * @param transaction - The transaction to read through.
     */
    private async resolveRelationsOf(
        entities: T[],
        relations: RelationTree,
        related: RelatedNarrowing | undefined,
        transaction: ValKeyTransaction | undefined
    ): Promise<void> {
        await RelationResolutionUtilities.resolveOn(this.entityClass, entities, relations, related, transaction, this.relatedRowsReader);
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
        const sorts: OrderSort[] = this.resolveSorts(order);
        if (!sorts.length) {
            return entities;
        }
        return [...entities].sort((a, b) => {
            for (const { path, compare } of sorts) {
                const comparison: number = compare(EntityOrderUtilities.valueAt(a, path), EntityOrderUtilities.valueAt(b, path));
                if (comparison !== 0) {
                    return comparison;
                }
            }
            return 0;
        });
    }

    /**
     * Resolves what an order compares, key by key.
     * @param order - The order, if any.
     * @returns Each key with where its value is and how two of them compare, none without an order.
     */
    private resolveSorts(order: DriverFindOptions<T>['order']): OrderSort[] {
        if (order == undefined) {
            return [];
        }
        // a property of one of the entities this reached through is compared exactly as a property
        // of the entity is - the only difference is how far the value is reached through, which the
        // key carries
        return EntityOrderUtilities.resolveKeys(order, this.entityClass).map(key => ({
            path: key.path,
            compare: EntityOrderUtilities.resolveComparator(key, (a, b) => this.compareValues(a, b))
        }));
    }

    /**
     * Resolves the ids of the rows a stream hands out, in its order.
     *
     * The rows are read a batch at a time, with the relations the filter and the order need and no
     * others, and of each match only its id and the values the order compares are kept: the order
     * is decided over every match before the first row is handed out, and those are all it needs.
     * @param candidates - The rows the stream may hand out.
     * @param options - The stream options, with the filter and the order.
     * @param transaction - The transaction to read through.
     * @returns The ids of the matching rows, in the order.
     */
    private async resolveIdsInOrder(
        candidates: Candidates,
        options: DriverStreamOptions<T>,
        transaction: ValKeyTransaction | undefined
    ): Promise<string[]> {
        const sorts: OrderSort[] = this.resolveSorts(options.order);
        const reading: DriverFindOptions<T> = { ...options, relations: this.relationsForReading(options) };
        const matched: OrderedId[] = [];
        for (let i: number = 0; i < candidates.ids.length; i += STREAM_BATCH_SIZE) {
            const batch: string[] = candidates.ids.slice(i, i + STREAM_BATCH_SIZE);
            const rows: Map<string, Record<string, string>> = await this.readCandidateRows(batch, candidates.rows, transaction);
            for (const entity of await this.resolveEntitiesOf(batch, rows, reading, transaction)) {
                if (options.where && !this.evaluator.matches(entity, options.where, this.entityClass)) {
                    continue;
                }
                matched.push({ id: String(entity.id), values: sorts.map(s => EntityOrderUtilities.valueAt(entity, s.path)) });
            }
        }
        return matched
            .sort((a, b) => {
                for (const [i, { compare }] of sorts.entries()) {
                    const comparison: number = compare(a.values[i], b.values[i]);
                    if (comparison !== 0) {
                        return comparison;
                    }
                }
                return 0;
            })
            .map(m => m.id);
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
        // by value: written out, `10` sorts before `9`
        if (NumberUtilities.isBigNumber(a) && NumberUtilities.isBigNumber(b)) {
            return NumberUtilities.compare(a, b);
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
     * Resolves the rows a filter may match, without reading every row where it can: the ones it pins
     * by their ids, the ones a unique declaration it names in full holds, the ones a built index it
     * names in full holds, or else every row.
     * @param where - The where filter of the query.
     * @param transaction - The transaction to read through.
     * @param readAlong - How many rows to read along with their ids at most, or undefined to read none.
     * @returns The candidates.
     */
    private async resolveCandidates(
        where: DriverFindOptions<T>['where'],
        transaction: ValKeyTransaction | undefined,
        readAlong: number | undefined
    ): Promise<Candidates> {
        const pinned: string[] | undefined = this.idsFromFilter(where);
        if (pinned != undefined) {
            return { ids: pinned, rows: undefined };
        }
        const candidates: Candidates | undefined = await this.candidatesFromUniqueFilter(where, transaction, readAlong)
            ?? await this.candidatesFromIndexFilter(where, transaction, readAlong);
        if (candidates != undefined) {
            return candidates;
        }
        const read: SetsWithRows = await this.readSetsWithRows([this.idsKey()], 0, transaction, readAlong);
        return { ids: read.members.at(0) ?? [], rows: read.rows };
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
     * Resolves the candidates of a filter that pins everything a unique declaration names.
     *
     * A miss is deliberately not an answer. The index is a shortcut, and a row written before its
     * declaration existed - or before this index did - carries no entry, so concluding "no such row"
     * from an empty one would hide it. Falling back reads every row, which is what the query would
     * have done anyway.
     * @param where - The where filter of the query.
     * @param transaction - The transaction to read through.
     * @param readAlong - How many rows to read along with their ids at most, or undefined to read none.
     * @returns The candidates, or undefined when the filter names no group or the index has no entry
     * for it.
     */
    private async candidatesFromUniqueFilter(
        where: DriverFindOptions<T>['where'],
        transaction: ValKeyTransaction | undefined,
        readAlong: number | undefined
    ): Promise<Candidates | undefined> {
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
        const read: SetsWithRows = await this.readSetsWithRows(keys, 0, transaction, readAlong);
        if (read.members.some(ids => !ids.length)) {
            return undefined;
        }
        return { ids: read.members.flat(), rows: read.rows };
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
     * Reads the members of sets, and in the same round trip the rows behind the first ids they hold, up
     * to a given number of them.
     *
     * One script rather than a pipeline, because which rows to read is only known once the sets are.
     * @param keys - The keys of the sets.
     * @param idSetsFrom - The position of the first set holding ids of rows. The ones before it hold
     * something else.
     * @param transaction - The transaction whose writes are laid over what is stored, if any.
     * @param readAlong - How many rows to read along at most, or undefined to read none.
     * @returns The members of each set, and the rows read along with them.
     * @throws When the store answers with something other than what the script returns.
     */
    private async readSetsWithRows(
        keys: string[],
        idSetsFrom: number,
        transaction: ValKeyTransaction | undefined,
        readAlong: number | undefined
    ): Promise<SetsWithRows> {
        if (readAlong == undefined) {
            return { members: await this.readSets(keys, transaction), rows: undefined };
        }
        const reply: GlideReturnType = await this.client.invokeScript(resolveReadSetsWithRowsScript(), {
            keys,
            args: [this.rowKey(''), String(readAlong), String(idSetsFrom)]
        });
        const [sets, ids, rows]: GlideReturnType[] = Array.isArray(reply) ? reply : [];
        if (!Array.isArray(sets) || sets.length !== keys.length) {
            throw new InternalError('Reading sets with their rows was not answered with the sets.');
        }
        const members: string[][] = keys.map((key, i) => {
            const stored: string[] = this.toReplyStrings(sets[i] ?? []);
            return transaction ? transaction.resolveSetMembers(key, stored) : stored;
        });
        if (!Array.isArray(ids) || !Array.isArray(rows) || rows.length !== ids.length) {
            throw new InternalError('Reading sets with their rows was not answered with a row for every id it read.');
        }
        const rowIds: string[] = this.toReplyStrings(ids);
        return {
            members,
            rows: new Map(rowIds.map((id, i) => {
                const stored: Record<string, string> | undefined = this.toRowOfFieldList(rows[i] ?? []);
                return [id, transaction ? transaction.resolveHash(this.rowKey(id), stored) : stored];
            }))
        };
    }

    /**
     * Reads rows by their ids, taking the ones read along with the ids from what was read.
     * @param ids - The ids of the rows.
     * @param readAlong - The rows read along with the ids, if any were.
     * @param transaction - The transaction whose writes are laid over what is stored, if any.
     * @returns The rows by their id, as {@link ValKeyRepositoryDriver.readRows} reads them.
     */
    private async readCandidateRows(
        ids: string[],
        readAlong: RowsReadAlong | undefined,
        transaction: ValKeyTransaction | undefined
    ): Promise<Map<string, Record<string, string>>> {
        if (readAlong == undefined) {
            return await this.readRows(ids, transaction);
        }
        // the rows past the bound, and those of ids a transaction added to a set, which the store did
        // not hold when the script ran
        const unread: string[] = ids.filter(id => !readAlong.has(id));
        const res: Map<string, Record<string, string>> = unread.length
            ? await this.readRows(unread, transaction)
            : new Map<string, Record<string, string>>();
        for (const id of ids) {
            const row: Record<string, string> | undefined = readAlong.get(id);
            if (row != undefined) {
                res.set(id, row);
            }
        }
        return res;
    }

    /**
     * Reads rows by their ids.
     * @param ids - The ids of the rows.
     * @param transaction - The transaction whose writes are laid over what is stored, if any.
     * @returns The rows by their id, as the json encoded fields they are stored as. An id holding no
     * row is left out.
     */
    private async readRows(ids: string[], transaction: ValKeyTransaction | undefined): Promise<Map<string, Record<string, string>>> {
        return (await this.readRowsAlongside(ids, transaction, false)).rows;
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
        const { rows, keys }: StoredRead = await this.readRowsAlongside(ids, transaction, true);
        return [rows, keys];
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
     * Reads rows by their ids, and when asked to, the indexes and uniques the store keeps and who holds
     * some unique values, all in one round trip.
     * @param ids - The ids of the rows.
     * @param transaction - The transaction whose writes are laid over the rows, if any.
     * @param withKeys - Whether to read the indexes and uniques along with them. None are named when not.
     * @param holderKeys - The keys of the unique values whose holders to read, as stored.
     * @returns The rows by their id, the indexes and uniques, and the holders by the key of their value.
     */
    private async readRowsAlongside(
        ids: string[],
        transaction: ValKeyTransaction | undefined,
        withKeys: boolean,
        holderKeys: string[] = []
    ): Promise<StoredRead> {
        const wanted: string[] = [...new Set(ids)].filter(id => transaction?.isDeleted(this.rowKey(id)) !== true);
        const keysKey: string = this.keysKey();
        const leading: string[] = [...withKeys ? [keysKey] : [], ...holderKeys];
        const sets: Set<string> = new Set(holderKeys);
        const replies: GlideReturnType[] = await this.readPipelined(
            [...leading, ...wanted.map(id => this.rowKey(id))],
            // eslint-disable-next-line cspell/spellchecker
            (batch, key) => key === keysKey ? batch.get(key) : sets.has(key) ? batch.smembers(key) : batch.hgetall(key)
        );
        const rowReplies: GlideReturnType[] = replies.slice(leading.length);

        const rows: Map<string, Record<string, string>> = new Map();
        for (const [i, id] of wanted.entries()) {
            const stored: Record<string, string> | undefined = this.toRow(rowReplies[i]);
            const row: Record<string, string> | undefined = transaction ? transaction.resolveHash(this.rowKey(id), stored) : stored;
            if (row != undefined) {
                rows.set(id, row);
            }
        }
        const holderReplies: GlideReturnType[] = replies.slice(withKeys ? 1 : 0, leading.length);
        return {
            rows,
            keys: withKeys ? this.toStoredKeys(replies[0]) : { uniques: [], indexes: [], stored: '' },
            holders: new Map(holderKeys.map((key, i) => [key, this.toMembers(holderReplies[i])]))
        };
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
        return { uniques: lists.uniques, indexes: lists.indexes, checks: lists.checks, stored };
    }

    /**
     * Applies writes as one step, but only while the indexes and uniques the store keeps are still the
     * ones they were worked out from, the rows they were worked out from are still as read, and no
     * transaction holds a key they overwrite.
     * @param writes - The writes, in the order they are applied.
     * @param keys - The indexes and uniques the writes were worked out from.
     * @param rows - The rows the writes were worked out from, by key, as they were read.
     * @returns True when the writes were applied, false when the list or a row had changed, or a
     * transaction held one of them, and nothing was.
     */
    private async writeGuarded(
        writes: ValKeyBufferedWrite[],
        keys: StoredKeys,
        rows: Map<string, Record<string, string>> = new Map()
    ): Promise<boolean> {
        // a held key has to stay as its transaction read it until that commits: it applies what it
        // worked out from that read, so a write landing in between would be written over by it, or a
        // removal undone (round-2/11 S14). A lock key is missing while nobody holds it
        const values: Map<string, string> = new Map([
            [this.keysKey(), keys.stored],
            ...this.resolveGrantKeys(writes).map((grantKey): [string, string] => [grantKey, ''])
        ]);
        return await applyGuardedValKeyWrites(this.client, { values, hashes: rows }, writes);
    }

    /**
     * Whether a transaction holds a key the writes overwrite, which a write outside one waits for.
     * @param writes - The writes.
     * @returns True when one of the keys is held.
     */
    private async isHeldByTransaction(writes: ValKeyBufferedWrite[]): Promise<boolean> {
        const grantKeys: string[] = this.resolveGrantKeys(writes);
        return grantKeys.length > 0 && await this.client.exists(grantKeys) > 0;
    }

    /**
     * The keys of the grants a transaction takes for the given writes: one for every key they
     * overwrite, as ValKeyTransaction.add takes them. Set writes commute and take none.
     * @param writes - The writes.
     * @returns The lock keys, each once.
     */
    private resolveGrantKeys(writes: ValKeyBufferedWrite[]): string[] {
        const overwritten: string[] = writes
            .filter(w => w.type === 'hashSet' || w.type === 'hashDelete' || w.type === 'delete')
            .map(w => w.key);
        return [...new Set(overwritten)].map(key => ValKeyLockKeyUtilities.getLockKey(key));
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

    /**
     * Reads a row out of a script's reply.
     * @param reply - The reply to reading the hash in a script, a list of its fields each followed by
     * its value.
     * @returns The fields, or undefined when there is no row.
     */
    private toRowOfFieldList(reply: GlideReturnType): Record<string, string> | undefined {
        const list: string[] = this.toReplyStrings(reply);
        if (!list.length) {
            return undefined;
        }
        return Object.fromEntries(PromiseUtilities.resolveChunks(list, 2).map(([field = '', value = '']) => [field, value]));
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
        if (metadata.type === Relation.MANY_TO_ONE || metadata.type === Relation.BELONGS_TO_ONE) {
            return metadata.joinColumn;
        }
        throw new InternalError(`The relation "${this.entityClass.name}.${key}" holds no foreign key of its own.`);
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