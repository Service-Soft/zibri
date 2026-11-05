import { findUpsertTargets } from './find-upsert-targets.function';
import { RemovalReach } from './removal-reach.model';
import { DriverAggregateOptions, DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { isRelationMetadata } from '../../entity/models/is-relation-metadata.function';
import { Relation } from '../../entity/models/relation.enum';
import { InternalError } from '../../error-handling/internal-error.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ChainUtilities } from '../chain/chain.utilities';
import { type DataSourceInterface } from '../data-sources/data-source.interface';
import { AggregateRow } from '../models/aggregate.model';
import { FindAllOptions } from '../models/options/find-all-options.model';
import { PaginationResult } from '../models/pagination-result.model';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { type RepositoryTransaction } from '../transaction/repository-transaction.type';
import { SpanningTransactionParticipants } from '../transaction/spanning-transaction-participants.model';
import { type SpanningTransaction } from '../transaction/spanning-transaction.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * What one write of a spanning transaction changed, as it is undone.
 */
type UndoneWrite<T extends BaseEntity> = {
    /**
     * The ids of the rows the write created, which undoing it removes.
     */
    created: string[],
    /**
     * The rows the write changed or removed, as they were before it, which undoing it writes back.
     */
    before: T[]
};

/**
 * Resolves a spanning transaction to the transaction of this driver's data source, and records how
 * to undo every write made in it.
 *
 * Innermost of the drivers a repository wraps its store's driver in, so that everything outside it -
 * the write observers, the repository - waits on the spanning transaction, and the store is handed a
 * transaction of its own. A transaction of the data source passes through untouched.
 */
export class SpanningTransactionRepositoryDriver<T extends BaseEntity> implements RepositoryDriverInterface<T, RepositoryTransaction> {
    /**
     * The properties of the entity that are stored as values of its row, the id among them.
     */
    private readonly columns: string[];

    /**
     * The many to many relations of the entity, whose sets a row is written back with.
     */
    private readonly manyToMany: string[];

    constructor(
        private readonly inner: RepositoryDriverInterface<T>,
        private readonly entityClass: Newable<T>,
        private readonly dataSource: DataSourceInterface
    ) {
        const properties: [string, PropertyMetadata][] = Object.entries(MetadataUtilities.getModelProperties(entityClass));
        this.columns = properties.filter(([, metadata]) => !isRelationMetadata(metadata)).map(([key]) => key);
        this.manyToMany = properties
            .filter(([, metadata]) => isRelationMetadata(metadata) && metadata.type === Relation.MANY_TO_MANY && metadata.persistence)
            .map(([key]) => key);
    }

    // ── reads ───────────────────────────────────────────────────

    // eslint-disable-next-line jsdoc/require-jsdoc
    async find(options: DriverFindOptions<T, RepositoryTransaction>): Promise<T[]> {
        return await this.inner.find({ ...options, transaction: await this.resolveTransaction(options.transaction) });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRelations(
        entities: T[],
        relations: FindAllOptions<T>['relations'],
        related: RelatedNarrowing | undefined,
        transaction: RepositoryTransaction | undefined
    ): Promise<T[]> {
        return await this.inner.resolveRelations(entities, relations, related, await this.resolveTransaction(transaction));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne(options: DriverFindOptions<T, RepositoryTransaction>): Promise<T | undefined> {
        return await this.inner.findOne({ ...options, transaction: await this.resolveTransaction(options.transaction) });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async count(options: DriverFindOptions<T, RepositoryTransaction>): Promise<number> {
        return await this.inner.count({ ...options, transaction: await this.resolveTransaction(options.transaction) });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async aggregate(options: DriverAggregateOptions<T, RepositoryTransaction>): Promise<AggregateRow[]> {
        return await this.inner.aggregate({ ...options, transaction: await this.resolveTransaction(options.transaction) });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T, RepositoryTransaction>): Promise<PaginationResult<T>> {
        return await this.inner.findAndCount({ ...options, transaction: await this.resolveTransaction(options.transaction) });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* stream(options: DriverStreamOptions<T, RepositoryTransaction>): AsyncIterable<T> {
        yield* this.inner.stream({ ...options, transaction: await this.resolveTransaction(options.transaction) });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIds(options: DriverFindOptions<T, RepositoryTransaction>): Promise<string[]> {
        return await this.inner.findIds({ ...options, transaction: await this.resolveTransaction(options.transaction) });
    }

    // ── writes ──────────────────────────────────────────────────

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: RepositoryTransaction | undefined, reload: boolean): Promise<T[]> {
        if (!this.isSpanning(transaction)) {
            return await this.inner.save(data, transaction, reload);
        }
        const own: Transaction = await this.resolveSpannedForWrite(transaction);
        const ids: string[] = data.flatMap(row => typeof row.id === 'string' ? [row.id] : []);
        const before: T[] = await this.findBefore(this.whereIdIn(ids), undefined, own, ids.length > 0 && this.isRestorable(transaction));
        const saved: T[] = await this.inner.save(data, own, reload);
        this.recordUndo(transaction, { created: this.idsNotIn(saved, before), before });
        return saved;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async insert(data: DeepPartial<T>[], transaction: RepositoryTransaction | undefined): Promise<T[]> {
        if (!this.isSpanning(transaction)) {
            return await this.inner.insert(data, transaction);
        }
        const own: Transaction = await this.resolveSpannedForWrite(transaction);
        const inserted: T[] = await this.inner.insert(data, own);
        this.recordUndo(transaction, { created: inserted.map(row => row.id), before: [] });
        return inserted;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: RepositoryTransaction | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        if (!this.isSpanning(transaction)) {
            return await this.inner.updateEach(rows, where, transaction, related);
        }
        const own: Transaction = await this.resolveSpannedForWrite(transaction);
        const before: T[] = await this.findBefore(where, related, own, this.isRestorable(transaction));
        const updated: T[] = await this.inner.updateEach(rows, where, own, related);
        this.recordUndo(transaction, { created: [], before: this.rowsIn(before, updated.map(row => row.id)) });
        return updated;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAll<R extends boolean = false>(
        options: DriverUpdateAllOptions<T, R, RepositoryTransaction>
    ): Promise<R extends true ? T[] : number> {
        const { transaction } = options;
        if (!this.isSpanning(transaction)) {
            return await this.inner.updateAll({ ...options, transaction });
        }
        const own: Transaction = await this.resolveSpannedForWrite(transaction);
        // every row the filter matches, since an update hands back how many it changed rather than which
        const before: T[] = await this.findBefore(options.where, options.related, own, this.isRestorable(transaction));
        const res: R extends true ? T[] : number = await this.inner.updateAll({ ...options, transaction: own });
        this.recordUndo(transaction, { created: [], before });
        return res;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: RepositoryTransaction | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        if (!this.isSpanning(transaction)) {
            return await this.inner.upsert(identity, rows, transaction, reachable, related);
        }
        const own: Transaction = await this.resolveSpannedForWrite(transaction);
        const before: T[] = this.isRestorable(transaction)
            ? await this.resolveBeforeImages(await findUpsertTargets(this.inner, identity, rows, own), own)
            : [];
        const written: T[] = await this.inner.upsert(identity, rows, own, reachable, related);
        this.recordUndo(transaction, { created: this.idsNotIn(written, before), before });
        return written;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async remove(ids: string[], reach: RemovalReach<T> | undefined, transaction: RepositoryTransaction | undefined): Promise<string[]> {
        if (!this.isSpanning(transaction)) {
            return await this.inner.remove(ids, reach, transaction);
        }
        const own: Transaction = await this.resolveSpannedForWrite(transaction);
        const before: T[] = await this.findBefore(this.whereIdIn(ids), undefined, own, ids.length > 0 && this.isRestorable(transaction));
        const removed: string[] = await this.inner.remove(ids, reach, own);
        this.recordUndo(transaction, { created: [], before: this.rowsIn(before, removed) });
        return removed;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeMatching(
        where: Where<T> | undefined,
        related: RelatedNarrowing | undefined,
        transaction: RepositoryTransaction | undefined
    ): Promise<string[]> {
        if (!this.isSpanning(transaction)) {
            return await this.inner.removeMatching(where, related, transaction);
        }
        const own: Transaction = await this.resolveSpannedForWrite(transaction);
        const before: T[] = await this.findBefore(where, related, own, this.isRestorable(transaction));
        const removed: string[] = await this.inner.removeMatching(where, related, own);
        this.recordUndo(transaction, { created: [], before: this.rowsIn(before, removed) });
        return removed;
    }

    // ── spanning ────────────────────────────────────────────────

    /**
     * Resolves the transaction to hand the store.
     * @param transaction - The transaction of the call.
     * @returns The transaction of this data source a spanning one reached it with, or the call's own.
     */
    private async resolveTransaction(transaction: RepositoryTransaction | undefined): Promise<Transaction | undefined> {
        return this.isSpanning(transaction) ? await this.resolveSpanned(transaction) : transaction;
    }

    /**
     * Resolves the transaction of this data source a spanning transaction reached it with, started
     * on its first use.
     * @param transaction - The spanning transaction.
     * @returns The transaction of this data source.
     * @throws When the entity is chained, or the data source cannot restore what a write to it changes.
     */
    private async resolveSpannedForWrite(transaction: SpanningTransaction): Promise<Transaction> {
        this.dataSource.validateSpanningWrite?.(this.entityClass);
        return await this.resolveSpanned(transaction);
    }

    /**
     * Resolves the transaction of this data source a spanning transaction reached it with, started
     * on its first use.
     * @param transaction - The spanning transaction.
     * @returns The transaction of this data source.
     * @throws When the entity is chained.
     */
    private async resolveSpanned(transaction: SpanningTransaction): Promise<Transaction> {
        // refused here too, for a caller whose types did not stop it: a row of a chain holds the hash
        // of the row before it, and putting a row back would leave the chain broken
        if (ChainUtilities.isChained(this.entityClass)) {
            throw new InternalError(
                `${this.entityClass.name} is chained, so its repository takes no spanning transaction: a row of a chain cannot be restored.`
            );
        }
        return await SpanningTransactionParticipants.of(transaction).resolveTransactionOn(this.dataSource);
    }

    private isSpanning(transaction: RepositoryTransaction | undefined): transaction is SpanningTransaction {
        return transaction?.spansDataSources === true;
    }

    /**
     * Reads the rows a write may change, as they are before it.
     * @param where - The rows the write may change.
     * @param related - What the rows the filter reaches through a relation are narrowed to.
     * @param transaction - The transaction of this data source the write is made in, so the rows are
     * read as the write finds them.
     * @param needed - Whether the write can change any row at all.
     * @returns The rows.
     */
    private async findBefore(
        where: Where<T> | undefined,
        related: RelatedNarrowing | undefined,
        transaction: Transaction,
        needed: boolean
    ): Promise<T[]> {
        return needed ? await this.resolveBeforeImages(await this.inner.find({ where, related, transaction }), transaction) : [];
    }

    /**
     * Whether the writes of this data source may have to be undone, and so need the rows as they were.
     * @param transaction - The spanning transaction.
     * @returns False for the data source it reached first, which is never restored.
     */
    private isRestorable(transaction: SpanningTransaction): boolean {
        return SpanningTransactionParticipants.of(transaction).isRestorable(this.dataSource);
    }

    /**
     * Resolves what writing back each of some rows takes: the values of its row, and the sets of its
     * many to many relations.
     *
     * The sets are read as well, since a store removes a row's join rows along with it, and an
     * update can replace them. Read again by id with nothing narrowing them, so a join row whose
     * other side the write's filter does not reach is written back all the same.
     * @param rows - The rows, as the store holds them.
     * @param transaction - The transaction of this data source the write is made in.
     * @returns The rows as they are written back.
     */
    private async resolveBeforeImages(rows: T[], transaction: Transaction): Promise<T[]> {
        if (!rows.length) {
            return [];
        }
        const withSets: Map<string, T> = this.manyToMany.length
            ? new Map((await this.inner.find({
                where: this.whereIdIn(rows.map(row => row.id)),
                relations: new Map(this.manyToMany.map(relation => [relation, new Map()])),
                transaction
            })).map(row => [row.id, row]))
            : new Map<string, T>();
        return rows.map(row => this.resolveBeforeImage(row, withSets.get(row.id)));
    }

    /**
     * Resolves what writing back one row takes.
     * @param row - The row, as the store holds it.
     * @param withSets - The same row with its many to many relations resolved, when it has any.
     * @returns The row as it is written back.
     */
    private resolveBeforeImage(row: T, withSets: T | undefined): T {
        const before: T = { ...row };
        // only what the row stores: a row is built from its class, and a class field initializing a
        // relation to an empty array would otherwise be written back as an empty set
        for (const key of Object.keys(before)) {
            if (!this.columns.includes(key)) {
                Reflect.deleteProperty(before, key);
            }
        }
        // a store that holds no value for a property leaves it out of the row it reads, and writing
        // a row back leaves out what it is not given, so the value the write set would stay. Null is
        // the nearest a write back can come to the value that was not there. A time read back keeps
        // milliseconds, where the store may have kept more
        for (const column of this.columns) {
            if (Reflect.get(row, column) === undefined) {
                // null rather than undefined: a write leaves out what is undefined, null clears the column
                Reflect.set(before, column, null);
            }
        }
        for (const relation of this.manyToMany) {
            const related: unknown = withSets == undefined ? undefined : Reflect.get(withSets, relation);
            Reflect.set(before, relation, Array.isArray(related) ? related.map((target: BaseEntity) => ({ id: target.id })) : []);
        }
        return before;
    }

    /**
     * Records how to undo a write: the rows it created are removed, and the rows it changed or
     * removed are written back as they were.
     * @param transaction - The spanning transaction the write was made in.
     * @param undone - What the write changed.
     */
    private recordUndo(transaction: SpanningTransaction, undone: UndoneWrite<T>): void {
        if (!this.isRestorable(transaction) || (!undone.created.length && !undone.before.length)) {
            return;
        }
        SpanningTransactionParticipants.of(transaction).recordUndo(this.dataSource, async own => {
            // the created rows first, so that a row written back finds the unique values it held free
            if (undone.created.length) {
                await this.inner.remove(undone.created, undefined, own);
            }
            if (undone.before.length) {
                await this.inner.save(undone.before, own, false);
            }
        });
    }

    /**
     * Gets the ids of the written rows that were not there before.
     * @param written - The rows a write handed back.
     * @param before - The rows it found.
     * @returns The ids of the rows it created.
     */
    private idsNotIn(written: T[], before: T[]): string[] {
        const existing: Set<string> = new Set(before.map(row => row.id));
        return written.map(row => row.id).filter(id => !existing.has(id));
    }

    /**
     * Gets the rows among the ones read before a write that the write reached.
     * @param before - The rows read before.
     * @param ids - The ids of the rows the write reached.
     * @returns Those rows.
     */
    private rowsIn(before: T[], ids: string[]): T[] {
        const reached: Set<string> = new Set(ids);
        return before.filter(row => reached.has(row.id));
    }

    /**
     * Gets the filter matching the rows with some ids.
     * @param ids - The ids.
     * @returns The filter.
     */
    private whereIdIn(ids: string[]): Where<T> {
        // the id of every entity, which `Where<T>` cannot be built from without knowing T
        return { id: { oneOf: ids } } as Where<T>;
    }
}