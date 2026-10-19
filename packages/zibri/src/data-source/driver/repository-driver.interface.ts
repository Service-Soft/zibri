import { BaseEntity } from '../../entity/base-entity.model';
import { type RelationTree } from '../../entity/models/entity-relations.model';
import { PaginationResult } from '../../open-api/pagination-result.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { OmitStrict } from '../../types/omit-strict.type';
import { FindAllOptions } from '../models/options/find-all-options.model';
import { type StreamOptions } from '../models/options/stream-options.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';
import { type WriteDataUtilities } from '../write-data.utilities';

/**
 * The resolved options that a repository driver receives for reading entities.
 *
 * Any defaults (eg. The default order or the default relations of an entity) have already
 * been applied by the repository, a driver only needs to apply what it is given.
 */
export type DriverFindOptions<T extends BaseEntity> = {
    /**
     * The where filter to find the entities by.
     */
    where?: Where<T>,
    /**
     * The order to return the entities in.
     */
    order?: FindAllOptions<T>['order'],
    /**
     * The relations to resolve on the found entities.
     *
     * Either as a caller wrote them or as a {@link RelationTree}, because a driver resolving one
     * relation reads the entity it reaches through the driver of that entity - and what it has to
     * hand on by then is the level below, which is already a tree.
     */
    relations?: FindAllOptions<T>['relations'] | RelationTree,
    /**
     * The amount of entities to skip.
     */
    skip?: number,
    /**
     * The maximum amount of entities to return.
     */
    take?: number,
    /**
     * The transaction to run the operation in.
     */
    transaction?: Transaction
};

/**
 * The resolved options for streaming, which are the find options minus everything a stream has no
 * answer for. See {@link StreamOptions} for why each one is absent.
 */
export type DriverStreamOptions<T extends BaseEntity> = OmitStrict<DriverFindOptions<T>, 'take' | 'skip' | 'order'>;

/**
 * The resolved options for reading a window and the total it is part of.
 */
export type DriverFindAndCountOptions<T extends BaseEntity> = DriverFindOptions<T> & {
    /**
     * What the total counts, when that is a wider question than the window's own filter.
     *
     * A page read by cursor narrows `where` to the rows after that cursor, which is not what its
     * total is about: a caller shown "20 of 137" means 137 rows matched, not 137 rows are left. The
     * two filters are read as of one moment all the same, so the total still describes the table the
     * items came out of. Left out when the window and the total ask the same thing.
     */
    totalWhere?: Where<T>
};

/**
 * The resolved options that a repository driver receives for changing every entity a filter matches.
 */
export type DriverUpdateAllOptions<T extends BaseEntity, R extends boolean = false> = {
    /**
     * The filter selecting the entities to change.
     */
    where?: Where<T>,
    /**
     * The changes to apply to every matching entity. An object is merged into the stored one, as
     * WriteDataUtilities.resolveMerged merges it.
     */
    data: DeepPartial<T>,
    /**
     * The transaction to run the operation in. A driver that needs one to be atomic takes its own
     * when this is undefined.
     */
    transaction?: Transaction,
    /**
     * Whether the updated entities are wanted back, instead of how many there were.
     */
    returnUpdated?: R
};

/**
 * The storage specific part of a repository.
 *
 * A Repository handles everything that is independent of the underlying storage (hooks, change sets,
 * soft deletes, pagination, ...) and delegates the actual reading and writing to a driver. That way the
 * same repositories can be used for eg. Postgres and ValKey.
 */
export interface RepositoryDriverInterface<T extends BaseEntity> {
    /**
     * Persists the given data.
     *
     * Entries without an id are inserted, entries with an existing id are updated.
     * @param data - The data to persist.
     * @param transaction - The transaction to run the operation in.
     * @param reload - Whether or not the persisted entities should be read back after saving.
     * @returns The persisted entities.
     */
    save: (data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean) => Promise<T[]>,

    /**
     * Writes rows that are new: each carries an id that was generated for it, which no stored row
     * holds. A driver may skip anything it does to find out whether a row is stored already.
     * @param data - The rows to write, each with its id.
     * @param transaction - The transaction to run the operation in.
     * @returns The written entities, in the order they were given.
     */
    insert: (data: DeepPartial<T>[], transaction: Transaction | undefined) => Promise<T[]>,

    /**
     * Writes each row's own values to the stored row holding its id, among the rows the filter
     * matches. A row it leaves alone keeps every property it does not give a value for, and an
     * object it gives is merged into the stored one, as {@link WriteDataUtilities.resolveMerged}
     * merges it.
     *
     * A driver may write them one at a time; doing it at once is what makes it cheaper than
     * updateAll once per row.
     * @param rows - The values to write, each with the id of the row to write them to.
     * @param where - The rows that may be written, naming the ids of every one of them.
     * @param transaction - The transaction to run the operation in.
     * @returns The rows written, as they are stored now. A row the filter does not match is neither.
     */
    updateEach: (rows: DeepPartial<T>[], where: Where<T>, transaction: Transaction | undefined) => Promise<T[]>,

    /**
     * Finds all entities that match the given options.
     * @param options - The resolved find options.
     * @returns The found entities.
     */
    find: (options: DriverFindOptions<T>) => Promise<T[]>,

    /**
     * Finds the first entity that matches the given options.
     * @param options - The resolved find options.
     * @returns The found entity or undefined when nothing matched.
     */
    findOne: (options: DriverFindOptions<T>) => Promise<T | undefined>,

    /**
     * Counts all entities that match the given options.
     * @param options - The resolved find options. Relations, skip and take are ignored.
     * @returns The amount of matching entities.
     */
    count: (options: DriverFindOptions<T>) => Promise<number>,

    /**
     * Reads one window of what a filter matches, and how many it matches in total, as of one moment.
     *
     * A page and a total taken as two statements are answers to the same question asked twice, and
     * anything written in between separates them: a total that counts rows the page does not hold,
     * or holds rows the total does not count. The pair is what a caller shows someone - "20 of 137"
     * - so it is the pair that has to be true, not each half on its own.
     *
     * How the two are read as of one moment is the store's business. A driver that can offer a
     * consistent read takes one; one that cannot reads as closely together as it can, and says so
     * here rather than leaving the repository above it to believe otherwise.
     * @param options - The resolved find options. `skip` and `take` window the page; the total
     * counts everything the filter matches, whatever the window is.
     * @returns The window, and the total the filter matches.
     */
    findAndCount: (options: DriverFindAndCountOptions<T>) => Promise<PaginationResult<T>>,

    /**
     * Reads everything that matches the given options without holding it all at once.
     *
     * On the interface rather than optional, for the reason `schemaLock` is: a `findAll` is bounded
     * so that a read which outgrows the heap says so instead of dying, and this is the way past that
     * bound. A data source that cannot offer one would leave its callers with no way to walk a large
     * table at all, which is not a gap the repository above it can fill.
     *
     * How is the store's own business and a caller cannot tell which ran - a server side cursor
     * where there is one, a page at a time where there is not. What every implementation owes is
     * that only a bounded part of the result is in memory at once, and that stopping early stops the
     * reading.
     * @param options - The resolved stream options. There is no `take`, `skip` or `order`: a stream
     * is the whole of what matched, and ordering it would mean holding all of it.
     * @returns The matching entities, one at a time.
     */
    stream: (options: DriverStreamOptions<T>) => AsyncIterable<T>,

    /**
     * Removes the rows with the given ids.
     *
     * The ids are all a store is handed: whatever else it needs to remove a row, such as the values
     * the row holds in an index, it reads itself, as the row is stored.
     * @param ids - The ids of the rows to remove.
     * @param transaction - The transaction to run the operation in.
     */
    remove: (ids: string[], transaction: Transaction | undefined) => Promise<void>,

    /**
     * Finds the ids of the matching entities, without handing back the entities.
     *
     * For a caller that needs to know which rows match and nothing about them, so that a large match
     * is not held in memory to be thrown away.
     * @param options - The resolved find options.
     * @returns The ids of the matching entities.
     */
    findIds: (options: DriverFindOptions<T>) => Promise<string[]>,

    /**
     * Applies the given changes to every row matching the filter, with no window for another writer
     * to interleave in.
     *
     * Reading the matching rows and then writing them back is not this, however it is wrapped: the
     * rows can change between the two, and both callers then believe they were the one that updated
     * them. Which mechanism closes that is the driver's business and differs per store.
     *
     * **Phantoms are not covered.** A row that begins matching the filter while this runs was never
     * matched, because it did not match when the filter was evaluated. Only a serializable isolation
     * level covers that, and it is a documented limit rather than a defect.
     *
     * The transaction follows the same rule as `upsert`: a driver that needs one to be atomic takes
     * its own when it was given none. Whether it needs one at all depends on the store and on what
     * is being asked - a store with a statement that selects, writes and reports the rows it wrote
     * needs nothing around it, and one that gets there in several steps has to hold them together.
     * Callers of the repository never have to think about it either way.
     * @param options - What to change, where, and whether the changed entities are wanted back.
     * @returns How many entities it changed, or those entities when they were asked for. A bulk
     * write knows how many it touched without looking at any of them, so handing them back is a
     * cost the caller decides to pay.
     */
    updateAll: <R extends boolean = false>(options: DriverUpdateAllOptions<T, R>) => Promise<R extends true ? T[] : number>,

    /**
     * Inserts each given row, or applies its `onConflict` to the row already holding its identity,
     * with no window for another writer to interleave in.
     *
     * Closing that window is the entire point. A read followed by a write cannot be made safe by
     * wrapping it in a lock: the lock only covers the window it is held for, and with a transaction
     * the write lands on commit, which is after that window has closed. Two callers then both read
     * 41 and both write 42.
     *
     * The properties in `identity` have to be declared together in `uniques` on the entity, in any
     * order, which `UpsertIdentityUtilities.resolveUniqueGroup` enforces. Without it the identity does not name at most one row.
     * Each row's identity is the values its `create` holds for them, and no two rows carry the same
     * one. An `onConflict` leaves the identity as it is.
     *
     * **Required rather than optional.** How the window is closed is the driver's business and
     * differs per store, but a caller cannot branch on which store it happens to be talking to, so
     * every driver has to answer.
     * @param identity - The properties identifying each row. Also the conflict target.
     * @param rows - What to insert, and what to change when the identity is already held. A row's
     * `where` is judged like `reachable`, for that row alone: a row holding the identity that does not
     * match it is refused the same way.
     * @param transaction - The transaction to run the operation in. The result is returned before the
     * transaction commits, so the caller can use it while the transaction is still open, and it is
     * rolled back along with everything else if the caller rolls back. A driver that needs one to be
     * atomic takes its own when this is undefined.
     * @param reachable - The rows an `onConflict` may be applied to, or undefined for any row. A row
     * holding an identity outside it is refused with a `UniqueConstraintViolationError`, as inserting
     * the identity would be - judged within the same window as the write, so the row cannot change
     * between the two. Rows written before the refused one may stay written; run the call in a
     * transaction when a refusal has to leave nothing behind.
     * @returns The rows as they are after the insert or the update, in the order they were given.
     */
    upsert: (
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined
    ) => Promise<T[]>
}