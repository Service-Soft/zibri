import { Readable } from 'node:stream';

import { EntityManager, FindManyOptions, FindOptionsOrder, FindOptionsRelations, FindOptionsSelect, FindOptionsWhere, QueryFailedError as TOQueryFailedError, QueryRunner, Repository as TORepository, SelectQueryBuilder, DeepPartial as ToDeepPartial, UpdateQueryBuilder, UpdateResult } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';

import { DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { AlsUtilities } from '../../context/als.utilities';
import { BaseEntity } from '../../entity/base-entity.model';
import { PaginationResult } from '../../open-api/pagination-result.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { TypeOrmUtilities } from '../../utilities/typeorm.utilities';
import { IsolationLevel } from '../data-sources/data-source.interface';
import { cancelsStatements, StatementCancellingDataSource } from '../data-sources/statement-cancelling-data-source.model';
import { type TypeOrmBaseDataSource } from '../data-sources/typeorm-base-data-source.model';
import { DataSourceOptions } from '../models/data-source-options.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { QueryFailedError } from '../query-failed.error';
import { MistypedStoredValue, StoredValueTypeMismatchError } from '../stored-value-type-mismatch.error';
import { Transaction } from '../transaction/transaction.model';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';

/**
 * How many streamed ids are read back as entities at once.
 *
 * The bound on what a stream holds, so it is a memory decision rather than a tuning one: large
 * enough that the round trip per batch is not what the read costs, small enough that a batch of
 * whatever the entity happens to be is not the thing that fills the heap.
 */
const STREAM_BATCH_SIZE: number = 500;

/**
 * The repository driver that reads and writes entities through typeorm.
 */
export class TypeOrmRepositoryDriver<T extends BaseEntity> implements RepositoryDriverInterface<T> {

    /**
     * The columns this entity declares, which is what a read of one row fills in.
     *
     * Resolved once, because the schema does not change while the process runs - everything else
     * about which columns those are is {@link TypeOrmUtilities.declaredColumnsOf}.
     */
    private readonly declaredColumns: ColumnMetadata[];

    constructor(
        private readonly entityClass: Newable<T>,
        private readonly typeOrmRepository: TORepository<T>,
        private readonly dataSource: TypeOrmBaseDataSource<DataSourceOptions>,
        private readonly maxBoundValuesPerStatement: number
    ) {
        this.declaredColumns = TypeOrmUtilities.declaredColumnsOf(typeOrmRepository.metadata);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        // the orm inserts a batch as one statement binding a value per column per row, and reads the
        // rows it is about to write by id first. Past what one statement binds, both are cut into
        // chunks - which the orm still runs inside the one transaction it runs a save in
        const chunk: number = Math.max(
            1,
            Math.floor(this.maxBoundValuesPerStatement / this.typeOrmRepository.metadata.columns.length)
        );
        return await this.run(async () => await this.onConnection(transaction, async manager => await manager.save(
            this.entityClass,
            data as ToDeepPartial<T>[],
            { reload, chunk }
        )));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async find(options: DriverFindOptions<T>): Promise<T[]> {
        return await this.run(async () => await this.onConnection(options.transaction, async manager => await manager.find(
            this.entityClass,
            {
                where: this.resolveWhere(options),
                ...this.orderAndRelations(options),
                skip: options.skip,
                take: options.take
            }
        )));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        const res: T | null = await this.run(async () => await this.onConnection(
            options.transaction,
            async manager => await manager.findOne(
                this.entityClass,
                {
                    where: this.resolveWhere(options),
                    ...this.orderAndRelations(options)
                }
            )
        ));
        return res ?? undefined;
    }

    /**
     * Says an order and a tree of relations in the words the orm reads them in.
     *
     * The one place the two meet, and nothing is translated: both are written the way the orm writes
     * them, and both name less than it accepts. What the orm cannot be shown is that they do -
     * its types are mapped over the entity, and an unresolved entity has no keys to map.
     *
     * Ordering by a relation and filtering on one both reach the store as a join that selects
     * nothing, so a row comes back holding what the relations asked for and no more.
     * @param options - The resolved find options.
     * @returns The two of them, ready to be spread into a find.
     */
    private orderAndRelations(options: DriverFindOptions<T>): Pick<FindManyOptions<T>, 'order' | 'relations'> {
        return {
            order: options.order as FindOptionsOrder<T> | undefined,
            relations: options.relations as FindOptionsRelations<T> | string[] | undefined
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async count(options: DriverFindOptions<T>): Promise<number> {
        return await this.run(async () => await this.onConnection(options.transaction, async manager => await manager.count(
            this.entityClass,
            { where: this.resolveWhere(options) }
        )));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        if (options.transaction != undefined) {
            // the caller's transaction already decides what both halves see, and starting a second
            // one inside it would read a different moment than the rest of their work does
            return await this.readPageAndTotal(options);
        }

        // REPEATABLE READ rather than the default: at READ COMMITTED every statement takes a new
        // snapshot, so wrapping the two in a transaction would leave them as far apart as they
        // were. This is the level at which a transaction sees one version of the database for its
        // whole length, which is the entire reason there is a transaction here.
        const transaction: Transaction = await this.dataSource.startTransaction({
            isolationLevel: IsolationLevel.REPEATABLE_READ
        });
        try {
            const res: PaginationResult<T> = await this.readPageAndTotal({ ...options, transaction });
            await transaction.commit();
            return res;
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Reads the page and the total, both through the transaction the options carry.
     * @param options - The resolved find options, carrying the transaction both halves read in.
     * @returns The window, and how many rows the filter matches.
     */
    private async readPageAndTotal(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        return {
            items: await this.find(options),
            totalAmount: await this.count(
                options.totalWhere == undefined ? options : { ...options, where: options.totalWhere }
            )
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async* stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        // the cursor carries ids and nothing else, and the rows are read back in batches through the
        // same `find` every other read uses. Two reasons, both of which cost more than they look:
        // a streamed row arrives raw, so hydrating it here would mean repeating what typeorm does
        // when it turns a result set into entities - transformers included, and `number` is stored
        // as DECIMAL and read back through one, so a hand hydrated row would carry strings where
        // every other path carries numbers. And relations are not something a single flat row
        // answers at all. What the cursor is still doing the work of is deciding *which* rows: it is
        // fixed when the query runs, where paging re-asks the question on every page and lets rows
        // shift across the boundaries.
        const alias: string = this.typeOrmRepository.metadata.name;
        const query: SelectQueryBuilder<T> = this.getManager(options.transaction)
            .createQueryBuilder(this.entityClass, alias)
            .setFindOptions({ where: this.resolveWhere(options) })
            .select(`${alias}.id`);

        const stream: Readable = await this.run(async () => await query.stream());
        let ids: T['id'][] = [];
        try {
            for await (const row of stream) {
                ids.push((row as Record<string, T['id']>)[`${alias}_id`] as T['id']);
                if (ids.length < STREAM_BATCH_SIZE) {
                    continue;
                }
                yield* await this.streamBatch(ids, options);
                ids = [];
            }
        }
        finally {
            // a caller that stopped early leaves the cursor open, and the connection it reads
            // through with it
            stream.destroy();
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
    private async streamBatch(ids: T['id'][], options: DriverStreamOptions<T>): Promise<T[]> {
        const found: T[] = await this.find({ ...options, where: { id: { oneOf: ids } } as Where<T> });
        // `oneOf` says which rows, never in which order. A stream is unordered, but it should at
        // least be *consistently* unordered - a batch coming back shuffled against the ids that
        // asked for it would be a second, invisible reordering on top of that
        const byId: Map<T['id'], T> = new Map(found.map(entity => [entity.id, entity]));
        // a row the cursor named and the read did not find was deleted in between, which a stream
        // over a moving table is allowed to miss
        return ids.map(id => byId.get(id)).filter((entity): entity is T => entity != undefined);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async remove(entities: T[], transaction: Transaction | undefined): Promise<T[]> {
        if (!entities.length) {
            return [];
        }

        // by id in one statement rather than `remove`, which issues a delete per entity. Relations
        // declaring a cascading remove are emitted as `ON DELETE CASCADE` on the constraint, so what
        // goes with a row is decided by the schema either way.
        await this.run(async () => await this.onConnection(transaction, async manager => await manager
            .createQueryBuilder()
            .delete()
            .from(this.entityClass)
            .where(this.resolveIdsWhere(entities.map(e => e.id)))
            .execute()));

        // the entities as they were, ids included. `remove` hands back the objects it was given with
        // their id stripped, on the grounds that the row is gone - but the id is what a caller
        // deleting by filter needs most, and every caller here has to put it back.
        return entities;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAll<R extends boolean = false>(
        options: DriverUpdateAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        if (!this.writesRelations(options.data) && this.filtersOwnColumnsOnly(options.where)) {
            return await this.updateInOneStatement(options);
        }
        return await this.inTransaction(
            options.transaction,
            async transaction => await this.updateThroughLockedRows(options, transaction)
        );
    }

    /**
     * Applies the change and hands back what it wrote, in a single statement.
     *
     * The statement that selects rows by a filter, writes them, and reports which ones it wrote -
     * which is the whole of what this operation promises, so nothing has to be held around it and
     * the rows cannot move between the steps, there being none. It is also what removes the read
     * after the write: the row a caller gets back is the row the write produced rather than one
     * fetched afterwards.
     *
     * Only for a change and a filter that stay on this table. An update statement has no joins, so
     * a filter reaching through a relation cannot be expressed in one, and a relation lives in rows
     * beside this one rather than in a column.
     * @param options - What to change, where, and whether the changed entities are wanted back.
     * @returns How many rows it wrote, or those rows when they were asked for.
     */
    private async updateInOneStatement<R extends boolean>(
        options: DriverUpdateAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        const { where, data, transaction, returnUpdated }: DriverUpdateAllOptions<T, R> = options;
        const resolved: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined = this.resolveWhere({ where });

        const res: UpdateResult = await this.run(async () => await this.onConnection(transaction, async manager => {
            // the entity is named as a type argument as well as a value, because a builder that has
            // not been told what it is over reads `update` as the overload taking the values to set
            // - and what comes back then describes no entity at all
            const builder: UpdateQueryBuilder<T> = manager
                .createQueryBuilder()
                .update<T>(this.entityClass)
                .set(data as QueryDeepPartialEntity<T>);

            // a filter naming no condition is how a caller asks for every row, and a statement with
            // no `WHERE` is how that is written. Handing the empty filter over instead is refused: a
            // write whose criteria render empty is the shape of a filter that silently evaporated,
            // and the store cannot tell that from one that means the whole table - only the caller
            // can, and this is where they said so
            if (resolved != undefined && !this.matchesEveryRow(resolved)) {
                builder.where(resolved);
            }
            if (returnUpdated === true) {
                // every column rather than the ones being written, because what a caller gets back
                // is the whole row - including the columns this change did not name
                builder.returning('*');
            }
            return await builder.execute();
        }));
        if (returnUpdated !== true) {
            return (res.affected ?? 0) as R extends true ? T[] : number;
        }
        return TypeOrmUtilities.toEntities(this.entityClass, this.declaredColumns, res.raw) as R extends true ? T[] : number;
    }

    /**
     * Applies the change to the rows a filter matches by holding them first, for the cases one
     * statement cannot reach.
     * @param options - What to change, where, and whether the changed entities are wanted back.
     * @param transaction - The transaction the rows are locked in.
     * @returns How many rows it wrote, or those rows when they were asked for.
     */
    private async updateThroughLockedRows<R extends boolean>(
        options: DriverUpdateAllOptions<T, R>,
        transaction: Transaction
    ): Promise<R extends true ? T[] : number> {
        const { where, data, returnUpdated }: DriverUpdateAllOptions<T, R> = options;
        // the lock is the difference between this and a read followed by a write. A plain select
        // takes none, so two callers both read the same rows and both write them; this one holds
        // them until the transaction commits. Postgres also re-checks the filter once it has been
        // granted each row, so a row that stopped matching while this waited is not returned here
        // and therefore not written.
        //
        // "of" the entity's own table only: a filter that reaches through a relation joins, and the
        // nullable side of an outer join cannot be locked.
        //
        // Only the ids are read: what the rows currently hold does not decide anything here, since
        // this is the branch that writes one value to all of them.
        const locked: T[] = await this.run(async () => await this.onConnection(transaction, async manager => await manager
            .find(this.entityClass, {
                select: { id: true } as FindOptionsSelect<T>,
                where: this.resolveWhere({ where }),
                lock: { mode: 'pessimistic_write', tables: [this.typeOrmRepository.metadata.tableName] }
            })));
        if (!locked.length) {
            return (returnUpdated === true ? [] : 0) as R extends true ? T[] : number;
        }

        const ids: T['id'][] = locked.map(l => l.id);
        // a relation is not a column on this row: a many-to-many lives in a join table whose rows
        // belong to one owner each, and an update statement cannot reach it. `save` writes rows that
        // each carry their own values, at one statement per row, which is what that costs. Everything
        // else is one statement however many rows it matched.
        await (this.writesRelations(data)
            ? this.save(locked.map(l => ({ ...data, id: l.id })), transaction, false)
            : this.run(async () => await this.onConnection(transaction, async manager => await manager
                .createQueryBuilder()
                .update(this.entityClass)
                .set(data as QueryDeepPartialEntity<T>)
                .where(this.resolveIdsWhere(ids))
                .execute())));

        if (returnUpdated !== true) {
            return ids.length as R extends true ? T[] : number;
        }

        // read back by id rather than by re-running the filter. The update may well have changed a
        // column the filter matches on - updateAll({ status: 'QUEUED' }, { status: 'SENT' }) being
        // the obvious case - and re-running it then returns the rows that were *not* touched.
        const updated: T[] = await this.find({ where: { id: { oneOf: ids } } as Where<T>, transaction });
        return updated as R extends true ? T[] : number;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined
    ): Promise<T[]> {
        // the data source rather than the driver, because the statement is dialect specific and the
        // driver is shared by every typeorm backed data source
        return await this.run(async () => await this.dataSource.upsert(this.entityClass, identity, rows, transaction, reachable));
    }

    /**
     * Whether the given change writes anything that is not a column of this entity's own table.
     *
     * Read from typeorm's own relation metadata rather than derived, because it is typeorm's update
     * builder that cannot express these - what counts as a relation has to be its answer.
     * @param data - The change about to be written.
     * @returns Whether any property of it is a relation.
     */
    private writesRelations(data: DeepPartial<T>): boolean {
        const relations: Set<string> = new Set(this.typeOrmRepository.metadata.relations.map(r => r.propertyName));
        return Object.keys(data).some(key => relations.has(key));
    }

    /**
     * Whether the filter can be answered without leaving this entity's own table.
     *
     * An update statement has no joins and no subqueries here, so a filter that names anything but
     * a column of this table has nowhere to be evaluated. Every branch of an or has to qualify:
     * one that does not is enough to make the whole filter unanswerable that way.
     * @param where - The filter about to be applied, as the caller wrote it.
     * @returns Whether every key of every branch names a column of this table.
     */
    /**
     * Whether a resolved filter leaves no row out.
     *
     * A property set to `undefined` is how a caller says the filter has nothing to say about it -
     * the way `withDeleted` drops the soft delete condition, and the way an optimistically locked
     * property is overwritten regardless - so a branch whose values are all undefined names no
     * condition at all.
     *
     * Every branch rather than any, although the branches are an OR and one that excludes nothing
     * lets every row in. A filter mixing an empty branch with a narrowing one reaches the store as
     * it does on a read, so the two keep answering about the same rows; a read narrowing where a
     * write widened would be worse than either.
     * @param resolved - The filter as the store's own find options.
     * @returns True when every row matches it.
     */
    private matchesEveryRow(resolved: FindOptionsWhere<T> | FindOptionsWhere<T>[]): boolean {
        const branches: FindOptionsWhere<T>[] = Array.isArray(resolved) ? resolved : [resolved];
        return branches.every(branch => Object.values(branch).every(value => value === undefined));
    }

    private filtersOwnColumnsOnly(where: Where<T> | undefined): boolean {
        const resolved: FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined = this.resolveWhere({ where });
        if (resolved == undefined) {
            return true;
        }
        const branches: FindOptionsWhere<T>[] = Array.isArray(resolved) ? resolved : [resolved];
        const columns: Set<string> = new Set(this.declaredColumns.map(c => c.propertyName));
        return branches.every(branch => Object.keys(branch).every(key => columns.has(key)));
    }

    private async inTransaction<R>(
        transaction: Transaction | undefined,
        fn: (transaction: Transaction) => Promise<R>
    ): Promise<R> {
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

    private getManager(transaction: Transaction | undefined): EntityManager {
        return transaction
            ? TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner.manager
            : this.typeOrmRepository.manager;
    }

    /**
     * Runs one operation, on a connection this can stop if the request it belongs to ends first.
     *
     * Outside a request there is nothing that could end, so the operation takes a connection the way
     * it always has and none of this is in the way. Inside one there has to be a connection to name
     * when the statement on it has to be stopped: a transaction already holds one and everything it
     * runs belongs on that one, and a statement standing alone gets one taken out for it - which the
     * orm does per statement anyway.
     *
     * A statement stopped inside a transaction takes the transaction with it, which is what it is
     * for. The request it belonged to has been answered, so nothing it writes is going to be asked
     * for; holding its rows until whatever it is queued behind lets go is the cost the deadline
     * exists to refuse.
     * @param transaction - The transaction the operation runs in, if there is one.
     * @param fn - The operation, given the manager to run on.
     * @returns Whatever the operation returned.
     */
    private async onConnection<R>(
        transaction: Transaction | undefined,
        fn: (manager: EntityManager) => Promise<R>
    ): Promise<R> {
        const signal: AbortSignal | undefined = AlsUtilities.findCurrentRequestSignal();
        const store: TypeOrmBaseDataSource<DataSourceOptions> = this.dataSource;
        if (!signal || !cancelsStatements(store)) {
            return await fn(this.getManager(transaction));
        }

        if (transaction) {
            const held: QueryRunner = TypeOrmUtilities.toTypeOrmTransaction(transaction).queryRunner;
            return await this.whileCancellable(signal, store, held, fn);
        }

        const runner: QueryRunner = this.dataSource.createQueryRunner();
        await runner.connect();
        try {
            return await this.whileCancellable(signal, store, runner, fn);
        }
        finally {
            // after the cancel has landed rather than before it. Handing the connection back first
            // would leave a cancel on its way to one the pool has already given to somebody else,
            // and it would stop their statement instead
            await runner.release();
        }
    }

    /**
     * Runs one operation on a named connection, with the request able to stop what is on it.
     * @param signal - The signal of the request the operation belongs to.
     * @param store - The data source, which is what knows how to stop a statement.
     * @param runner - The connection the operation runs on.
     * @param fn - The operation, given the manager to run on.
     * @returns Whatever the operation returned.
     */
    private async whileCancellable<R>(
        signal: AbortSignal,
        store: StatementCancellingDataSource,
        runner: QueryRunner,
        fn: (manager: EntityManager) => Promise<R>
    ): Promise<R> {
        // kept so that whoever owns the connection waits for the cancel before doing anything else
        // with it
        // eslint-disable-next-line jsdoc/require-jsdoc
        const cancelling: { pending: Promise<void> | undefined } = { pending: undefined };
        const onAbort: () => void = () => {
            cancelling.pending = store.cancelStatementOn(runner);
        };
        signal.addEventListener('abort', onAbort, { once: true });

        try {
            return await fn(runner.manager);
        }
        finally {
            signal.removeEventListener('abort', onAbort);
            // a failed cancel is not this operation's failure to report: the statement it was aimed
            // at has either stopped or finished, and the caller is being told about whichever
            await cancelling.pending?.catch(() => undefined);
        }
    }

    private resolveWhere(options: DriverFindOptions<T>): FindOptionsWhere<T> | FindOptionsWhere<T>[] | undefined {
        if (!options.where) {
            return undefined;
        }
        return this.dataSource.whereFilterToFindOptionsWhere(options.where, this.entityClass);
    }

    /**
     * The filter naming exactly the given rows, in the store's own find options.
     *
     * Through the converter rather than the orm's `whereInIds`, which binds one value per id and so
     * fails past as many rows as a statement binds values - a `deleteAll` of a large table being the
     * obvious case. How a list of ids is bound is the dialect's to say, and the converter says it.
     * @param ids - The ids of the rows.
     * @returns The filter.
     */
    private resolveIdsWhere(ids: T['id'][]): FindOptionsWhere<T> | FindOptionsWhere<T>[] {
        return this.dataSource.whereFilterToFindOptionsWhere({ id: { oneOf: ids } } as Where<T>, this.entityClass);
    }

    private async run<R>(operation: () => Promise<R>): Promise<R> {
        try {
            return await operation();
        }
        catch (error) {
            if (error instanceof TOQueryFailedError) {
                const failed: QueryFailedError = new QueryFailedError(error as TOQueryFailedError);
                const violated: string[] | undefined = this.dataSource.violatedUniqueProperties(error as TOQueryFailedError);

                // the same declaration refusing the same write has to be the same error whichever
                // store it was made in, because `unique` is declared on the entity: an application
                // reacting to a duplicate would otherwise have to know which store it is talking to.
                // Only spotting it is dialect specific, which is why that part is asked of the
                // data source. The failed query is kept as the cause, so the sql is still readable.
                if (violated) {
                    throw new UniqueConstraintViolationError(this.entityClass.name, violated, { cause: failed });
                }

                // a json column is the one place a stored value can contradict what the entity says
                // it is, and the server answers that with the value alone - which reads like the
                // query is broken rather than like one row is. Named here so the property is in the
                // message, with the statement kept as the cause the same way the violation above is
                const mistyped: MistypedStoredValue | undefined = this.dataSource.mistypedJsonValue(
                    error as TOQueryFailedError,
                    this.entityClass.name
                );
                if (mistyped) {
                    throw new StoredValueTypeMismatchError(mistyped, { cause: failed });
                }
                throw failed;
            }
            throw error;
        }
    }
}