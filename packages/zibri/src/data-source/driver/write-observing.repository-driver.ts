import { findUpsertRowOf, findUpsertTargets } from './find-upsert-targets.function';
import { ForwardingRepositoryDriver } from './forwarding.repository-driver';
import { RemovalReach } from './removal-reach.model';
import { DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { GlobalRegistry } from '../../global/global-registry';
import { LifecyclePhase } from '../../global/lifecycle-phase.enum';
import { type LoggerInterface } from '../../logging/logger.interface';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { AggregateRow } from '../models/aggregate.model';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';
import { EntityWrite, EntityWriteObserver, RowWrite, WriteOperation, WrittenRows } from '../write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../write-observers/entity-write-observer.registry';

/**
 * A write, as it is observed.
 */
type Write<R> = {
    /**
     * Which operation it is.
     */
    operation: WriteOperation,
    /**
     * What it writes, row by row.
     */
    data: object[],
    /**
     * The transaction of the write, if any.
     */
    transaction: Transaction | undefined,
    /**
     * Reads what the write does to each row, before it is made.
     */
    readRowWrites: (observers: EntityWriteObserver[]) => Promise<RowWrite[]>,
    /**
     * Makes the write.
     */
    run: () => Promise<R>,
    /**
     * The rows the write changed, from what it answered and what it does to each row.
     */
    resolveWritten: (result: R, rowWrites: RowWrite[]) => Pick<WrittenRows, 'before' | 'after'>
};

/**
 * What a write does to each row, once it is read, which happens once per write.
 */
type RowWritesRead = {
    /**
     * The reading, started by the first that asked.
     */
    rowWrites?: Promise<RowWrite[]>
};

/**
 * Hands every write to the observers of its entity: each checks it before it is made, and follows it
 * once it is committed.
 *
 * Every way a row is written reaches the store through this seam, however the repository above it got
 * there. The rows a write changes are read once, before it, for every observer that needs them; a
 * write to an entity nobody observes reads nothing. Every read forwards.
 */
export class WriteObservingRepositoryDriver<T extends BaseEntity> extends ForwardingRepositoryDriver<T> {
    /**
     * The observers of the entity, kept once no more can be registered.
     */
    private observers: EntityWriteObserver[] | undefined;

    constructor(
        inner: RepositoryDriverInterface<T>,
        private readonly entityClass: Newable<T>,
        private readonly logger: LoggerInterface
    ) {
        super(inner);
    }

    override async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        return await this.observe({
            operation: 'save',
            data,
            transaction,
            readRowWrites: async () => {
                const ids: string[] = data.flatMap(row => typeof row.id === 'string' ? [row.id] : []);
                const existing: T[] = ids.length ? await this.inner.find({ where: this.whereIdIn(ids), transaction }) : [];
                return data.map(row => ({ data: row, existing: existing.find(stored => stored.id === row.id) }));
            },
            run: async () => await super.save(data, transaction, reload),
            resolveWritten: (saved, rowWrites) => ({ before: this.existingOf(rowWrites), after: saved })
        });
    }

    override async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        return await this.observe({
            operation: 'insert',
            data,
            transaction,
            // eslint-disable-next-line typescript/require-await
            readRowWrites: async () => data.map(row => ({ data: row, existing: undefined })),
            run: async () => await super.insert(data, transaction),
            resolveWritten: inserted => ({ before: [], after: inserted })
        });
    }

    override async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: Transaction | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        return await this.observe({
            operation: 'updateEach',
            data: rows,
            transaction,
            readRowWrites: async () => (await this.inner.find({ where, related, transaction })).map(stored => ({
                // a row naming an id writes that row only, any other the rows the write matched
                data: rows
                    .filter(row => row.id == undefined || row.id === stored.id)
                    .reduce<object>((merged, row) => ({ ...merged, ...row }), {}),
                existing: stored
            })),
            run: async () => await super.updateEach(rows, where, transaction, related),
            resolveWritten: (updated, rowWrites) => ({ before: this.existingOf(rowWrites), after: updated })
        });
    }

    override async remove(ids: string[], reach: RemovalReach<T> | undefined, transaction: Transaction | undefined): Promise<string[]> {
        return await this.observe({
            operation: 'remove',
            data: [],
            transaction,
            // read first: a remove is handed ids, and what it removes is only on the rows
            readRowWrites: async observers => ids.length
                ? await this.readRemovedRows(observers, this.whereIdIn(ids), undefined, transaction)
                : [],
            run: async () => await super.remove(ids, reach, transaction),
            resolveWritten: (removed, rowWrites) => this.resolveRemoved(removed, rowWrites)
        });
    }

    override async removeMatching(
        where: Where<T> | undefined,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined
    ): Promise<string[]> {
        return await this.observe({
            operation: 'remove',
            data: [],
            transaction,
            readRowWrites: async observers => await this.readRemovedRows(observers, where, related, transaction),
            run: async () => await super.removeMatching(where, related, transaction),
            resolveWritten: (removed, rowWrites) => this.resolveRemoved(removed, rowWrites)
        });
    }

    /**
     * Reads the rows a removal may remove, as what the observers need of them, since a sweep of
     * expired rows removes a table's worth at once.
     * @param observers - The observers of the entity.
     * @param where - The rows the removal may remove.
     * @param related - What the rows of each entity the filter reaches through a relation are narrowed to.
     * @param transaction - The transaction of the removal, if any.
     * @returns What the removal does to each row.
     */
    private async readRemovedRows(
        observers: EntityWriteObserver[],
        where: Where<T> | undefined,
        related: RelatedNarrowing | undefined,
        transaction: Transaction | undefined
    ): Promise<RowWrite[]> {
        return (await this.inner.find({
            where,
            related,
            select: new Map(['id', ...observers.flatMap(observer => observer.properties)].map(property => [property, true])),
            transaction
        })).map(existing => ({ data: undefined, existing }));
    }

    /**
     * Gets the rows a removal removed, of the ones it read before.
     * @param removed - The ids of the rows it removed.
     * @param rowWrites - What it read it does to each row.
     * @returns The rows as they were, and none after.
     */
    private resolveRemoved(removed: string[], rowWrites: RowWrite[]): Pick<WrittenRows, 'before' | 'after'> {
        const removedIds: Set<string> = new Set(removed);
        return {
            before: this.existingOf(rowWrites).filter(row => removedIds.has(String(Reflect.get(row, 'id')))),
            after: []
        };
    }

    override async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        return await this.observe({
            operation: 'updateAll',
            data: [options.data],
            transaction: options.transaction,
            // as the distinct values the observers need rather than as rows, since a filter can match
            // every row of a table
            readRowWrites: async observers => {
                const groups: AggregateRow[] = await this.inner.aggregate({
                    where: options.where,
                    related: options.related,
                    transaction: options.transaction,
                    fn: 'count',
                    property: undefined,
                    groupBy: [...new Set(observers.flatMap(observer => observer.properties))]
                });
                return groups.map(group => ({ data: options.data, existing: group.group }));
            },
            run: async () => await super.updateAll(options),
            // an update hands back how many rows it changed rather than which
            resolveWritten: (_, rowWrites) => ({
                before: this.existingOf(rowWrites),
                after: this.existingOf(rowWrites).map(row => ({ ...row, ...options.data }))
            })
        });
    }

    override async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        return await this.observe({
            operation: 'upsert',
            // what a row is inserted with, and what it is set to when it is already there
            data: rows.flatMap(row => [row.create, this.resolveSetOnConflict(row)]),
            transaction,
            readRowWrites: async () => {
                const targets: T[] = await findUpsertTargets(this.inner, identity, rows, transaction);
                return rows.map(row => {
                    const existing: T | undefined = targets.find(stored => findUpsertRowOf(identity, rows, stored) === row);
                    return existing == undefined ? { data: row.create, existing } : { data: this.resolveSetOnConflict(row), existing };
                });
            },
            run: async () => await super.upsert(identity, rows, transaction, reachable, related),
            resolveWritten: (written, rowWrites) => ({ before: this.existingOf(rowWrites), after: written })
        });
    }

    /**
     * Makes a write, checked by every observer of the entity before, and followed by them once it is
     * committed.
     * @param write - The write.
     * @returns What the write answers.
     */
    private async observe<R>(write: Write<R>): Promise<R> {
        const observers: EntityWriteObserver[] = this.resolveObservers();
        if (!observers.length) {
            return await write.run();
        }
        const read: RowWritesRead = {};
        const resolveRowWrites: () => Promise<RowWrite[]> = async () => {
            read.rowWrites ??= write.readRowWrites(observers);
            return await read.rowWrites;
        };
        for (const observer of observers) {
            await observer.validateWrite?.({
                operation: write.operation,
                data: write.data,
                resolveRowWrites,
                transaction: write.transaction
            });
        }
        const following: EntityWriteObserver[] = observers.filter(observer => observer.handleWritten != undefined);
        if (!following.length) {
            return await write.run();
        }
        const entityWrite: EntityWrite = { operation: write.operation, data: write.data };
        // before the write, which changes them, when one of them follows them or a check read them
        const rowWrites: RowWrite[] = following.some(observer => observer.followsBefore?.(entityWrite) === true)
            || read.rowWrites != undefined
            ? await resolveRowWrites()
            : [];
        const result: R = await write.run();
        const written: WrittenRows = { ...entityWrite, ...write.resolveWritten(result, rowWrites) };
        const handle: () => Promise<void> = async () => {
            for (const observer of following) {
                try {
                    await observer.handleWritten?.(written);
                }
                catch (error) {
                    // the write stands either way, so this is worth knowing and not worth failing it over
                    this.logger.error(new InternalError(`Could not follow a write to ${this.entityClass.name}`, { cause: error }));
                }
            }
        };
        // once committed, since following a write that is rolled back would follow what never happened
        if (write.transaction == undefined) {
            await handle();
        }
        else {
            write.transaction.afterCommit(handle);
        }
        return result;
    }

    /**
     * Resolves the observers of the entity.
     * @returns The observers, none for an entity nobody observes.
     */
    private resolveObservers(): EntityWriteObserver[] {
        if (this.observers != undefined) {
            return this.observers;
        }
        const observers: EntityWriteObserver[] = inject(EntityWriteObserverRegistry).findObservers(this.entityClass);
        // kept once no more can be registered, and asked again before: a write made while the
        // application starts can come before the services register theirs
        if (GlobalRegistry.isLifecyclePhaseFinished(LifecyclePhase.AFTER_APP_INIT)) {
            this.observers = observers;
        }
        return observers;
    }

    /**
     * Reads what an upsert sets on a row that is already there.
     * @param row - The row of the upsert.
     * @returns What it sets, by property, leaving out what it changes by an amount.
     */
    private resolveSetOnConflict(row: UpsertRow<T>): object {
        const set: Record<string, unknown> = {};
        for (const [key, update] of Object.entries<unknown>(row.onConflict)) {
            if (typeof update === 'object' && update != undefined && 'set' in update) {
                set[key] = update.set;
            }
        }
        return set;
    }

    /**
     * Gets the rows as they were of a write.
     * @param rowWrites - What the write does to each row.
     * @returns The rows it changes that are there already.
     */
    private existingOf(rowWrites: RowWrite[]): object[] {
        return rowWrites.flatMap(rowWrite => rowWrite.existing ?? []);
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