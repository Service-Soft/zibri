import { AlsUtilities } from '../../context/als.utilities';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../entity/entity-metadata-missing.error';
import { type EntityOrder } from '../../entity/models/entity-order.model';
import { denyAll, type DenyAll } from '../../entity/models/entity-scope.model';
import { Relation } from '../../entity/models/relation.enum';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { ForbiddenError } from '../../error-handling/errors/forbidden.error';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { InternalError } from '../../error-handling/internal-error.model';
import { boundEncryptionProperties } from '../../global/model-registry/encrypt-encryption-properties.function';
import { ModelRegistry } from '../../global/model-registry/model.registry';
import { $ts } from '../../localization/translate.function';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { LoggerInterface } from '../../logging/logger.interface';
import { KeysetPage, PaginationResult } from '../../open-api/pagination-result.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { WhereFilterEvaluator } from '../data-sources/where-converter/where-filter.evaluator';
import { DeadlineAwareRepositoryDriver } from '../driver/deadline-aware.repository-driver';
import { DriverFindOptions, DriverStreamOptions, RepositoryDriverInterface } from '../driver/repository-driver.interface';
import { TracedRepositoryDriver } from '../driver/traced.repository-driver';
import { BeforeReturnHook } from '../hooks/before-return';
import { BeforeSaveHook, SaveOperation } from '../hooks/before-save';
import { afterCursorWhere, keysetStepsFor, keysetValuesOf } from '../keyset/after-cursor-where.function';
import { keysetFingerprint, KeysetOrderKey, resolveKeysetOrder } from '../keyset/keyset-order.model';
import { AtomicUpdate } from '../models/atomic-update.model';
import { decodeKeysetCursor, encodeKeysetCursor } from '../models/keyset-cursor.model';
import { BaseRepositoryOptions } from '../models/options/base-repository-options.model';
import { BulkWriteOptions } from '../models/options/bulk-write-options.model';
import { CountOptions } from '../models/options/count-options.model';
import { CreateAllOptions } from '../models/options/create-all-options.model';
import { CreateOptions } from '../models/options/create-options.model';
import { DeleteAllOptions } from '../models/options/delete-all-options.model';
import { DeleteByIdOptions } from '../models/options/delete-by-id-options.model';
import { FindAllOptions } from '../models/options/find-all-options.model';
import { FindAllPaginatedOptions } from '../models/options/find-all-paginated-options.model';
import { FindByIdOptions } from '../models/options/find-by-id-options.model';
import { FindOneOptions } from '../models/options/find-one-options.model';
import { StreamOptions } from '../models/options/stream-options.model';
import { UpdateAllOptions } from '../models/options/update-all-options.model';
import { UpdateByIdOptions } from '../models/options/update-by-id-options.model';
import { UpsertOptions } from '../models/options/upsert-options.model';
import { WriteRelationsOptions } from '../models/options/write-relations-options.model';
import { FuzzySearchUtilities } from '../models/where/fuzzy-search.utilities';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { resolveEntityScope } from '../scopes/resolve-entity-scope.function';
import { ScopedWhere, ScopeWhereUtilities } from '../scopes/scope-where.utilities';
import { Transaction } from '../transaction/transaction.model';
import { validateWriteIsNotBlind } from '../validate-write-is-not-blind.function';
import { declaresUuidFormat, dropImpossibleConditions } from '../where/drop-impossible-conditions.function';

/**
 * How many rows a bulk update may touch before it says out loud that it is writing them one by one.
 *
 * A bound encrypted value cannot be written to many rows in a single statement, so an update that
 * looks like one write is really one per row. Below this that is not worth mentioning; above it, it
 * is the kind of thing somebody wants to find in a log rather than in a latency graph.
 */
const bulkBoundUpdateWarningThreshold: number = 100;

/**
 * How many rows a `findAll` that names no limit may return before it is refused.
 *
 * Not a memory figure - ten thousand rows is a few megabytes, and the read this exists to stop is
 * the one that streams millions. It is the point past which a call that asked for everything has
 * stopped meaning it: the table it was written against was small, and it has since grown into
 * something that should be read a page at a time.
 *
 * High enough that the reads which legitimately want everything - a lookup table, a tenant's users,
 * a nightly export - stay below it, because being refused is a hard failure and a limit that trips
 * on ordinary work is worse than the unbounded read it replaced.
 */
export const UNBOUNDED_FIND_ALL_LIMIT: number = 10000;

/**
 * A row after an update, together with the change that produced it.
 *
 * The change a caller passes is not the change that lands: the id is added, and the save hooks fill
 * in whatever they fill in. Anything recording what happened - a change set, an audit trail - needs
 * the second one, and cannot get it by reading the row back, because a row read afterwards carries
 * every column nobody touched and any change another writer made in between.
 *
 * Paired rather than returned as two lists, because a bulk update produces one of these per row - a
 * value bound to its row is encrypted for that row, so the rows of a single update do not all carry
 * the same change - and two lists that have to stay in step are two lists that can fall out of it.
 */
export type WrittenUpdate<T extends BaseEntity> = {
    /**
     * The row as it is now.
     */
    entity: T,
    /**
     * The change that was written to it.
     *
     * A partial of the entity rather than the caller's own update type: the hooks add properties the
     * caller's type never declared, so what was written is wider than what was asked for.
     */
    written: DeepPartial<T>
};

/**
 * What a bulk update did, in both of the shapes a caller can ask for.
 *
 * One type rather than two return signatures, because the work of deciding which entities to write
 * is the same either way and only what is read back afterwards differs.
 */
export type BulkUpdate<T extends BaseEntity> = {
    /**
     * How many entities the update changed.
     */
    count: number,
    /**
     * Each changed entity with the change that produced it. Empty unless they were asked for.
     */
    updates: WrittenUpdate<T>[]
};

/**
 * The property types that name another entity rather than a value stored in the row.
 */
const RELATION_TYPES: Set<string> = new Set(Object.values(Relation));

/**
 * A repository that handles data source related things for its entity.
 *
 * Everything that is independent of the underlying storage is handled here, the actual reading
 * and writing is delegated to the {@link RepositoryDriverInterface} that this repository was created with.
 */
export class Repository<
    T extends BaseEntity,
    CreateData extends DeepPartial<T> = DeepPartial<T>,
    UpdateData extends DeepPartial<T> = DeepPartial<T>
> {
    /**
     * The storage specific part of this repository.
     */
    protected readonly driver: RepositoryDriverInterface<T>;

    private readonly _dataSource: DataSourceInterface;

    /**
     * The metadata of entity that this repository manages.
     */
    protected readonly entityMetadata: EntityMetadata<T>;

    /**
     * Answers whether a row satisfies a filter without asking the store.
     *
     * Needed by the write half of a scope: a filter says which rows a caller may see, and the only way
     * to tell whether the row being written is one of them is to evaluate it here.
     */
    private readonly evaluator: WhereFilterEvaluator = new WhereFilterEvaluator();

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The data source that this repository is connected to.
     */
    get dataSource(): DataSourceInterface {
        return this._dataSource;
    }

    constructor(
        protected readonly entityClass: Newable<T>,
        repo: RepositoryDriverInterface<T> | Repository<T>,
        protected readonly logger: LoggerInterface,
        dataSource: DataSourceInterface,
        private readonly beforeSave: BeforeSaveHook<T, CreateData, UpdateData>,
        private readonly beforeReturn: BeforeReturnHook<T>
    ) {
        // wrapped once here rather than at every call: a repository built on another one already
        // holds a wrapped driver, so taking that one keeps a nested repository from recording each
        // of its reads twice. The refusal sits outside the tracing, so an operation that never
        // reached the store leaves no span claiming it did
        this.driver = repo instanceof Repository
            ? repo.driver
            : new DeadlineAwareRepositoryDriver(new TracedRepositoryDriver(repo, entityClass));
        ModelRegistry.get(this.entityClass);
        const metadata: EntityMetadata<T> | undefined = MetadataUtilities.getEntityMetadata(this.entityClass);
        if (!metadata) {
            throw new EntityMetadataMissingError(this.entityClass);
        }
        this._dataSource = dataSource;
        this.entityMetadata = metadata;
    }

    /**
     * Resolves the transaction of a **write** and records it when one is running under a lease.
     *
     * Only writes go through here. A read inside an open transaction is harmless, while a write is
     * the thing a grant stops covering once the commit moves outside it.
     * @param options - The options the write was called with.
     * @returns The transaction to hand to the driver, if any.
     */
    private writeTransaction(options?: BaseRepositoryOptions): Transaction | undefined {
        if (options?.transaction != undefined) {
            AlsUtilities.recordTransactionInLeaseScope(options.transaction);
        }
        return options?.transaction;
    }

    /**
     * Applies the defaults of the entity to the given options.
     * @param options - The options provided by the caller.
     * @param where - The filter to query with, already narrowed by the entity's scopes.
     * @returns Find options that a driver can be called with.
     */
    private toDriverFindOptions(
        options: FindAllOptions<T> | FindOneOptions<T> | undefined,
        where: Where<T> | undefined
    ): DriverFindOptions<T> {
        const allOptions: FindAllOptions<T> | undefined = options as FindAllOptions<T> | undefined;
        // 'all' is the absence of a limit as far as the store is concerned. The difference
        // between saying it and saying nothing is handled by findAll, which is where it matters
        const take: number | undefined = allOptions?.take === 'all' ? undefined : allOptions?.take;
        return {
            where,
            order: this.totalOrder(
                allOptions?.order ?? this.entityMetadata.defaultOrder,
                allOptions?.skip != undefined || take != undefined
            ),
            relations: options?.relations ?? this.entityMetadata.defaultRelations,
            skip: allOptions?.skip,
            take,
            transaction: options?.transaction
        };
    }

    /**
     * Completes an order so that it names at most one row per position.
     *
     * Only for a read that takes part of the result: which rows the store hands back then depends on
     * where each one sits, and an order that leaves two rows interchangeable leaves that to the
     * store. Postgres answers an update by writing a new version of the row elsewhere, so a table
     * being written to reorders itself under a walk that named no order - the same row comes back on
     * a later page and one that was never read is passed over. Ties do the same on a smaller scale:
     * `createdAt` alone is not a total order the moment two rows share a timestamp.
     *
     * The primary key is what makes it total, because it is the one property no two rows share. An
     * unbounded read is left alone: it hands back everything that matched, so nothing depends on
     * where the rows sit, and an order the caller did not ask for is a sort the store has to do.
     * @param order - The order the caller asked for, or the entity's default.
     * @param bounded - Whether the read takes part of the result rather than all of it.
     * @returns An order that decides every position, when the read needs one.
     */
    private totalOrder(order: FindAllOptions<T>['order'], bounded: boolean): FindAllOptions<T>['order'] {
        if (!bounded || (order != undefined && 'id' in order)) {
            return order;
        }
        // the last key rather than the only one: what the caller asked to be ordered by still
        // decides the order, this only decides what the caller's order left open.
        // Stated rather than inferred, because an order is mapped over the entity and an unresolved
        // one has no keys to map - so nothing can be shown to be one of them, `id` included
        return { ...order, id: 'ASC' } as EntityOrder<T>;
    }

    /**
     * Resolves what a stream asked for into what a driver receives.
     *
     * The entity's `defaultRelations` still apply - a streamed row is the row `findAll` hands back.
     * `defaultOrder` does not, because a stream has no order to give: see {@link StreamOptions}.
     * @param options - What the caller asked for.
     * @param where - The filter, already narrowed by the entity's scopes.
     * @returns The resolved options for the driver.
     */
    private toDriverStreamOptions(
        options: StreamOptions<T> | undefined,
        where: Where<T> | undefined
    ): DriverStreamOptions<T> {
        return {
            where,
            relations: options?.relations ?? this.entityMetadata.defaultRelations,
            transaction: options?.transaction
        };
    }

    /**
     * Narrows what a call asked for by the scopes its entity declares, and by what its properties are
     * able to hold.
     *
     * Every read and every write goes through here, which is the point: a restriction declared on the
     * entity holds for the queries nobody remembered to guard just as much as for the ones they did.
     * @param where - The filter the caller asked for, if any.
     * @param options - The options the call was made with, carrying `unscoped`.
     * @returns The filter to use, or the note that nothing can match it.
     */
    protected async scopedWhere(
        where: Where<T> | undefined,
        options?: BaseRepositoryOptions
    ): Promise<ScopedWhere<T>> {
        const scope: Where<T> | DenyAll | undefined = await resolveEntityScope(
            this.entityClass,
            this.entityMetadata,
            options?.unscoped
        );
        if (scope === denyAll) {
            return { matchesNothing: true, where: undefined };
        }

        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(this.entityClass);
        // asked of what the caller wrote rather than of the merged filter, so that the property a
        // refusal names is one they can find, and a scope the entity adds is never what is refused.
        // Here rather than in each store, so that a search either is answered from an index or is not
        // accepted, whichever store the repository is over
        FuzzySearchUtilities.validateSearchable(where, properties, this.entityClass);

        const scoped: ScopedWhere<T> = ScopeWhereUtilities.applyToWhere(where, scope, properties);
        if (scoped.matchesNothing || scoped.where == undefined) {
            return scoped;
        }

        // `unscoped` does not reach this: it exempts a call from what the entity restricts, not from
        // what it is able to store. A value no row can carry stays an empty answer either way
        const possible: WhereFilter<T>[] = dropImpossibleConditions(
            ScopeWhereUtilities.branchesOf(scoped.where),
            properties
        );
        if (!possible.length) {
            return { matchesNothing: true, where: undefined };
        }
        return { matchesNothing: false, where: possible.length === 1 ? possible[0] : possible };
    }

    /**
     * Refuses a write that would put a row outside the scope the caller is restricted to.
     *
     * The read half narrows what comes back; without this half a caller creates rows they are not
     * allowed to see and then reads them entirely legitimately, and moves rows out of their own reach
     * by updating whatever the scope keys on.
     *
     * **Runs after `beforeSave`, and has to.** That hook is where a property's `default` is applied,
     * and filling the owner of a row from the current user through a default is an ordinary thing to
     * write - checking before it ran would inspect a value that is not the one being stored, and
     * leave whatever the default produced unchecked.
     *
     * An update carries only the columns it changes, so it is judged on those alone: a condition on a
     * column the update does not touch already held, or the row could not have been reached to update
     * it in the first place.
     * @param data - The data about to be written, as it will be stored.
     * @param operation - Whether the row is being created or changed.
     * @param options - The options the call was made with, carrying `unscoped`.
     * @throws When the resulting row would fall outside the scope.
     */
    protected async applyScopeToData(
        data: DeepPartial<T>,
        operation: SaveOperation.CREATE | SaveOperation.UPDATE,
        options?: BaseRepositoryOptions
    ): Promise<void> {
        const scope: Where<T> | DenyAll | undefined = await resolveEntityScope(
            this.entityClass,
            this.entityMetadata,
            options?.unscoped
        );
        if (scope == undefined) {
            return;
        }

        // any branch, not every: the scope's branches are an OR, so a row that satisfies one of them
        // is a row the caller may see
        const allowed: boolean = scope !== denyAll && ScopeWhereUtilities.branchesOf(scope).some(branch => {
            const applicable: WhereFilter<T> = operation === SaveOperation.CREATE
                ? branch
                : this.conditionsOn(branch, data);
            return this.evaluator.matches(data as T, applicable, this.entityClass);
        });

        if (!allowed) {
            // recorded, where a refused *read* is not: a read that comes back empty cannot be told
            // apart from a row that is simply not there - which is the property the 404 exists for -
            // while a write landing outside the scope is a caller stating what they intended
            this.logger.audit({
                action: AuditAction.AUTHORIZATION,
                outcome: AuditOutcome.FAILURE,
                reason: AuditReason.OUT_OF_SCOPE
            });
            throw new ForbiddenError(
                $ts`You cannot write a ${this.entityClass.name} outside what you are allowed to see.`
            );
        }
    }

    /**
     * The part of a scope's condition that the given change actually decides.
     *
     * A change carries only the columns it writes, so judging it against a condition on a column it
     * leaves alone would refuse an ordinary update: that column already satisfied the scope, or the
     * read half would not have let this row be reached.
     * @param fragment - One branch of the scope's condition.
     * @param data - The change about to be written.
     * @returns The conditions on the columns the change carries.
     */
    private conditionsOn(fragment: WhereFilter<T>, data: DeepPartial<T>): WhereFilter<T> {
        const res: Record<string, unknown> = {};
        for (const [property, condition] of Object.entries(fragment)) {
            if (property in data) {
                res[property] = condition;
            }
        }
        return res as WhereFilter<T>;
    }

    /**
     * Creates a new entity from the given data.
     * @param data - The create data.
     * @param options - Additional options, like a transaction etc.
     * @returns The newly created entity.
     */
    async create(data: CreateData, options?: CreateOptions<T>): Promise<T> {
        // everything below writes to what it is given - the generated id, the defaults `beforeSave`
        // fills in, whatever the driver hands back - and the caller still holds the object they
        // passed. Shallow, which covers every column: a nested object is shared, and the hooks that
        // reach into one are the encryption hooks, which is a narrower thing than this.
        const own: CreateData = { ...data };
        if (own.id != undefined && options?.allowId != true) {
            this.logger.warn('Found an id on the create data, it will be ignored.');
            delete own.id;
        }
        this.assignId(own);
        await this.beforeSave(own, SaveOperation.CREATE, this.entityClass);
        await this.applyScopeToData(own, SaveOperation.CREATE, options);

        const [res] = await this.driver.save([own], this.writeTransaction(options), true);
        if (res == undefined) {
            throw new InternalError(`Saving one "${this.entityClass.name}" returned no row.`);
        }

        // a write resolves the relations its own data named and knows nothing of the rest, so an
        // entity that reads one by default answered with it only when the caller happened to pass
        // it. Read once the row exists, the same way an upsert does - and *before* the hooks below,
        // because that read runs them on the row it returns and this one is about to be discarded
        const relations: FindAllOptions<T>['relations'] = this.relationsToResolve(options);
        if (relations != undefined) {
            return await this.findById(res.id, { relations, transaction: options?.transaction, unscoped: options?.unscoped });
        }

        await this.beforeReturn(res, this.entityClass, true);
        return res;
    }

    /**
     * The relations a write hands its row back with.
     *
     * What the caller asked for, and what the entity reads by default when they asked for nothing -
     * so that a written row is the row finding it by its id would give. Undefined means there is
     * nothing to resolve and the write can answer on its own.
     * @param options - The caller's options, which may name relations.
     * @returns The relations to resolve, or undefined when there are none.
     */
    private relationsToResolve(options: WriteRelationsOptions<T> | undefined): FindAllOptions<T>['relations'] {
        return options?.relations ?? this.entityMetadata.defaultRelations;
    }

    /**
     * Inserts a row, or applies the given changes to the row that already holds the identity, with
     * no window for another writer to interleave in.
     *
     * Reach for this when a value depends on what is already stored - a counter being the usual
     * case. Reading it, changing it and writing it back cannot be made safe by holding a lock: the
     * lock only covers the window it is held for, and with a transaction the write lands on commit,
     * which is after that window has closed. Two callers then both read the same value and both
     * write the same result, and nothing anywhere reports it.
     *
     * The properties in `identity` have to be declared together in `uniques` on the entity, in any
     * order. Without that the identity does not name at most one row.
     *
     * Every data source supports this. How the window is closed differs - one statement on sql, a
     * grant held across the read on valkey - and a caller cannot tell which ran.
     *
     * A `belongsToOne` or `manyToOne` may be named in `create`, and is written as the foreign key it
     * resolves to. The other three relation kinds have nothing in this row to write - their key
     * lives on the row at the other end, or in a join table - so writing one means writing rows
     * beside this one, which is the window this method exists to close. Those are refused.
     * @param identity - The properties identifying the row, and their values.
     * @param create - The full row to insert when nothing matches the identity yet.
     * @param onConflict - The changes to apply when a row already matches.
     * @param options - Additional options, eg. A transaction. The result is returned before the
     * transaction commits, and is rolled back with it.
     * @returns The row as it is after the insert or the update, with its relations resolved.
     */
    async upsert(
        identity: DeepPartial<T>,
        create: CreateData,
        onConflict: AtomicUpdate<T>,
        options?: UpsertOptions<T>
    ): Promise<T> {
        // a copy, for the reason `create` takes one. An id the caller chose is kept either way -
        // `assignId` fills one in only when there is none - what changes is that a *generated* id
        // lands here rather than on the object the caller still holds.
        const own: CreateData = { ...create };
        this.assignId(own);
        await this.beforeSave(own, SaveOperation.CREATE, this.entityClass);
        await this.applyScopeToData(own, SaveOperation.CREATE, options);
        // the identity is the conflict target as well as the filter, and its properties have to be a
        // declared unique group - so the owner cannot be added to it the way a scope is added to a
        // where filter. What can be refused is an identity that names a different owner outright
        await this.applyScopeToData(identity, SaveOperation.UPDATE, options);
        // before the driver, so that both stores answer the same way. Postgres builds one statement
        // out of the create data and had no column to put a relation in; valkey resolves a to-one
        // relation to its foreign key while saving and quietly accepted what postgres threw on
        this.writeRelationsAsForeignKeys(own);

        const res: T = await this.driver.upsert(identity, own, onConflict, this.writeTransaction(options));

        const relations: FindAllOptions<T>['relations'] = this.relationsToResolve(options);
        if (relations != undefined) {
            // read once the row exists, rather than as part of writing it. An upsert used to hand
            // back a row with its relations missing while the property was not typed optional, so
            // reading through one was a TypeError on an entity every other read returns resolved.
            // That read runs the hooks below on the row it returns, so this one skips them
            return await this.findById(res.id, { relations, transaction: options?.transaction, unscoped: options?.unscoped });
        }

        await this.beforeReturn(res, this.entityClass, true);
        return res;
    }

    /**
     * Replaces the relations named in create data with the foreign keys they resolve to.
     * @param data - The create data, changed in place.
     * @throws When a relation has no key on this row, or names something with no id to write.
     */
    private writeRelationsAsForeignKeys(data: CreateData): void {
        const properties: Record<string, PropertyMetadata> = MetadataUtilities.getModelProperties(this.entityClass);
        // the one place this reads and writes properties the entity's type does not name - a join
        // column is derived from a relation rather than passed in. The valkey driver asserts the same
        // boundary, for the same reason
        const writable: Record<string, unknown> = data as Record<string, unknown>;

        for (const key of Object.keys(writable)) {
            const metadata: PropertyMetadata | undefined = properties[key];
            if (metadata == undefined || !RELATION_TYPES.has(metadata.type)) {
                continue;
            }
            if (metadata.type !== Relation.BELONGS_TO_ONE && metadata.type !== Relation.MANY_TO_ONE) {
                throw new InternalError([
                    `"${this.entityClass.name}.${String(key)}" cannot be part of an upsert.`,
                    `A ${metadata.type} relation is not stored on this row, so writing it means writing rows beside`,
                    'this one - and an upsert is one statement, which is what makes it safe to read a value and',
                    'change it. Write the other side separately, or use create.'
                ]);
            }
            if (metadata.joinColumn == undefined) {
                throw new InternalError([
                    `"${this.entityClass.name}.${String(key)}" declares no joinColumn,`,
                    'so there is no property on this row to write its foreign key into.'
                ]);
            }

            const value: unknown = writable[key];
            const id: unknown = value != undefined && typeof value === 'object' && 'id' in value ? value.id : value;
            if (typeof id !== 'string') {
                throw new InternalError([
                    `"${this.entityClass.name}.${String(key)}" was given something with no id.`,
                    'An upsert writes the foreign key of a relation, so the row it points at has to exist already.'
                ]);
            }

            writable[metadata.joinColumn] = id;
            // eslint-disable-next-line typescript/no-dynamic-delete
            delete writable[key];
        }
    }

    /**
     * Creates all entities from the provided data array.
     * @param data - An array of create data, which each creates a new entity.
     * @param options - Additional options, eg. A transaction.
     * @returns All newly created entities.
     */
    async createAll(data: CreateData[], options?: CreateAllOptions<T>): Promise<T[]> {
        // one copy per entry, for the reason `create` takes one
        const own: CreateData[] = data.map(d => ({ ...d }));
        const entitiesWithIdCount: number = (await Promise.all(
            own.map(async d => {
                let hadId: boolean = false;
                if (d.id != undefined && options?.allowId != true) {
                    delete d.id;
                    hadId = true;
                }
                this.assignId(d);
                await this.beforeSave(d, SaveOperation.CREATE, this.entityClass);
                await this.applyScopeToData(d, SaveOperation.CREATE, options);
                return hadId;
            })
        )).filter(Boolean).length;
        if (entitiesWithIdCount) {
            this.logger.warn(
                `Found an id on ${entitiesWithIdCount} out of ${data.length} entries of the create data. These ids will be ignored.`
            );
        }

        const res: T[] = await this.driver.save(own, this.writeTransaction(options), true);
        return await this.writtenEntities(res, options);
    }

    /**
     * The rows a bulk write hands over, with their relations resolved.
     *
     * The bulk half of {@link writtenEntity}, and the one thing that differs: a write resolves the
     * relations its own data named and knows nothing of the rest, so the rows are read once the
     * write has landed. Once for the whole batch rather than once per row, which is what a call
     * with no bound on how many rows it answers with can afford.
     *
     * Read through the driver rather than through `findAll`, because these rows do not have to be
     * found again - the write already narrowed them by every scope a read narrows by, and a row a
     * soft delete just marked deleted is still a row this call wrote.
     * @param written - The rows the write produced.
     * @param options - What the write was called with, naming the relations and the transaction.
     * @returns The rows in the order they were written, each through the return hook.
     */
    private async writtenEntities(written: T[], options: BulkWriteOptions<T> | undefined): Promise<T[]> {
        const relations: FindAllOptions<T>['relations'] = this.relationsToResolve(options);
        if (relations == undefined || !written.length) {
            await Promise.all(written.map(r => this.beforeReturn(r, this.entityClass, true)));
            return written;
        }

        const read: T[] = await this.driver.find({
            where: { id: { oneOf: written.map(w => w.id) } } as Where<T>,
            relations,
            transaction: options?.transaction
        });
        await Promise.all(read.map(r => this.beforeReturn(r, this.entityClass, true)));

        // paired by id rather than by position: the read is a query of its own, and nothing says a
        // store answers one in the order the ids went into it. The order the rows were written in is
        // the order a caller passed them in, which is the only one they can recognize
        const byId: Map<T['id'], T> = new Map(read.map(r => [r.id, r]));
        return written.map(w => {
            const entity: T | undefined = byId.get(w.id);
            if (entity == undefined) {
                throw new InternalError(
                    `Reading "${this.entityClass.name}" back after writing it found no row with id "${w.id}".`
                );
            }
            return entity;
        });
    }

    /**
     * Gives the data being created an id, unless it already brought one.
     *
     * The id used to be the driver's to generate, which meant it did not exist while the save hooks
     * ran - so a hook could see everything about a row except which row it was. Encryption needs
     * exactly that, to bind a value to the row it is stored in, and any hook that wants to reference
     * the row it is preparing has the same problem. Generating it here also makes the id come from
     * the same place whichever data source is behind the repository.
     * @param data - The data about to be created.
     * @throws When the data brings an id that the id property says it cannot hold.
     */
    private assignId(data: CreateData): void {
        // a declared format is what every read narrows by, so a value outside it would make the row
        // impossible to find through its own id. Refused at the write instead, where the caller that
        // chose the value is still there to be told
        if (
            data.id != undefined
            && declaresUuidFormat(MetadataUtilities.getModelProperties(this.entityClass)['id'])
            && !UUIDUtilities.isUuid(data.id)
        ) {
            throw new InternalError(
                `"${this.entityClass.name}.id" declares the uuid format, so "${data.id}" cannot be stored as one. `
                + 'An entity whose ids are chosen rather than generated declares '
                + '`@Property.string({ primary: true, format: undefined })`.'
            );
        }
        data.id ??= UUIDUtilities.generate();
    }

    /**
     * Finds an entity by the given id.
     * @param id - The id of the entity to find.
     * @param options - Additional options, eg. Transaction or whether a result is required.
     * @returns The found entity. If required is set to false, also undefined.
     */
    async findById<B extends boolean = true>(
        id: T['id'],
        options?: FindByIdOptions<T, B>
    ): Promise<B extends false ? T | undefined : T> {
        // combined with whatever the caller asked for rather than replacing it. Spreading the options
        // over the id let a `where` they carried take the id's place, so the read looked for any row
        // matching that filter instead of for this one
        const byId: ScopedWhere<T> = ScopeWhereUtilities.applyToWhere(
            options?.where,
            [{ id } as WhereFilter<T>],
            MetadataUtilities.getModelProperties(this.entityClass)
        );
        const res: T | undefined = byId.matchesNothing
            ? undefined
            : await this.findOne({ ...options, where: byId.where, required: false });
        if (!res && options?.required !== false) {
            throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
        }
        return res as B extends false ? T | undefined : T;
    }

    /**
     * Finds a single entity with the given options.
     * @param options - The options, including the where filter, whether a result is required etc.
     * @returns The found result. If required is set to false, also undefined.
     */
    async findOne<B extends boolean = true>(
        options: FindOneOptions<T, B>
    ): Promise<B extends false ? T | undefined : T> {
        const scoped: ScopedWhere<T> = await this.scopedWhere(options.where, options);
        // a row the scope excludes is answered exactly like one that does not exist, so a caller
        // cannot use a guarded route to find out which ids are real
        const res: T | undefined = scoped.matchesNothing
            ? undefined
            : await this.driver.findOne(this.toDriverFindOptions(options, scoped.where));

        if (!res && options.required !== false) {
            throw new NotFoundError($ts`Could not find ${this.entityClass.name}.`);
        }
        if (!res) {
            return undefined as B extends false ? T | undefined : T;
        }
        await this.beforeReturn(res, this.entityClass, options.autoDecrypt ?? true);
        return res;
    }

    /**
     * Finds all entities with the given options.
     * @param options - The options, including the where filter etc.
     * @returns An array of found entities.
     */
    async findAll(options?: FindAllOptions<T>): Promise<T[]> {
        const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
        if (scoped.matchesNothing) {
            return [];
        }

        const driverOptions: DriverFindOptions<T> = this.toDriverFindOptions(options, scoped.where);
        // a call that names no limit is claiming the result is small enough to hold, and this checks
        // that claim rather than believing it. One row more than the cap is asked for, so getting
        // that row back is proof there was something past the cap - a result of exactly the cap is
        // a table that fits, not one that was cut short.
        //
        // Read from what the caller passed rather than from the driver options, because `'all'`
        // reaches the store as no limit too and is the one case that is deliberate
        const probe: number = UNBOUNDED_FIND_ALL_LIMIT + 1;
        const unbounded: boolean = options?.take == undefined;
        if (unbounded) {
            driverOptions.take = probe;
        }

        const res: T[] = await this.driver.find(driverOptions);
        if (unbounded && res.length === probe) {
            // refused rather than trimmed. Handing back the first thousand rows of a larger table
            // would make every caller that loops over the result quietly do part of its work - half
            // the mails sent, half the rows migrated - and nothing would say so. A table that has
            // outgrown what a call assumed is worth hearing about at the call that assumed it
            throw new InternalError(
                `${this.entityClass.name}.findAll() matched more than ${UNBOUNDED_FIND_ALL_LIMIT} rows without a limit.`
                + ' Pass a `take`, use findAllPaginated, or pass `take: \'all\'` if reading every row is meant.'
            );
        }

        await Promise.all(res.map(r => this.beforeReturn(r, this.entityClass, options?.autoDecrypt ?? true)));
        return res;
    }

    /**
     * Reads every entity matching the given options, without holding them all at once.
     *
     * The way past the bound `findAll` puts on a read that names no limit. `findAll` refuses above
     * {@link UNBOUNDED_FIND_ALL_LIMIT} because a result that outgrew the heap is worth hearing about
     * at the call that assumed it would not; this is how a caller says it is not holding the result
     * at all, so there is nothing left to outgrow.
     *
     * Narrowed by the same scopes every other read is, and each entity goes through the same
     * `beforeReturn` - decryption included - so a streamed row is the row `findAll` would have
     * handed back.
     *
     * Stopping early stops the reading: `break` out of the loop and nothing further is fetched.
     * @param options - The where filter and the relations to resolve. There is no limit and no
     * order - see {@link StreamOptions}.
     * @yields Each matching entity, in turn.
     * @example
     * for await (const invoice of invoiceRepository.stream({ where: { paid: false } })) {
     *     await this.remind(invoice);
     * }
     */
    async* stream(options?: StreamOptions<T>): AsyncIterable<T> {
        const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
        if (scoped.matchesNothing) {
            return;
        }

        for await (const entity of this.driver.stream(this.toDriverStreamOptions(options, scoped.where))) {
            await this.beforeReturn(entity, this.entityClass, options?.autoDecrypt ?? true);
            yield entity;
        }
    }

    /**
     * Finds all entities with the given options, in paginated form.
     *
     * The page and the total describe one moment: they are read together, so `totalAmount` counts
     * the table the `items` came out of. Both are narrowed by the same scopes every other read is,
     * so a total says how many rows this caller may see.
     *
     * Ordered down to the single row - by primary key after whatever order was asked for - because
     * which rows a page holds depends on where each one sits. An order that leaves two rows
     * interchangeable leaves that to the store, and a table being written to answers differently
     * each time it is asked.
     * @param page - The page for which the entities should be found, counted from 1.
     * @param limit - The limit of entities to receive for that page.
     * @param options - Additional options including where filter etc.
     * @returns A paginated result of the found entities.
     */
    async findAllPaginated(page: number, limit: number, options?: FindAllPaginatedOptions<T>): Promise<PaginationResult<T>> {
        // narrowed once and used for both halves. The count used to be taken from the caller's
        // filter alone, which on a scoped entity reported how many rows exist rather than how many
        // the caller may see - a leak the page of items itself does not have
        const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
        if (scoped.matchesNothing) {
            return { items: [], totalAmount: 0 };
        }

        // one call rather than a read and then a count. The two are answers to the same question,
        // and asking it twice lets anything written in between separate them: a total that counts
        // rows the page does not hold, or holds rows the total does not count. What a caller shows
        // someone is the pair - "20 of 137" - so it is the pair that has to be true. Which is also
        // why the page is not read through `findAll`: its bound is for a call that named no limit,
        // and this one always names one.
        const res: PaginationResult<T> = await this.driver.findAndCount(this.toDriverFindOptions(
            { ...options, skip: (page - 1) * limit, take: limit },
            scoped.where
        ));

        await Promise.all(res.items.map(i => this.beforeReturn(i, this.entityClass, options?.autoDecrypt ?? true)));
        return res;
    }

    /**
     * Reads the page that continues after a cursor, rather than the page at a position.
     *
     * What this answers and `findAllPaginated` does not is a walk that spans requests. A page number
     * counts rows from the start, so a row written before the walk reaches its position shifts every
     * page after it: rows repeat and rows are passed over, and no single call can fix that, because
     * the pages are separate reads. A cursor names the row the last page ended at, so the next page
     * is "everything after this one" and stays right whatever was written meanwhile. It also stays
     * fast: reading page five thousand by number means the store counting past everything before it.
     *
     * **Every row that exists when the walk starts is handed back exactly once.** Rows written during
     * it are reached when they sort after the cursor and passed over when they sort before it, which
     * is what "after this row" means and cannot be otherwise. Order by properties that do not change,
     * for that reason: editing a row's ordering property while a walk is running can move it across
     * the cursor, and it is then read twice or not at all.
     *
     * The order has to decide a position for every row, so it is refused when it cannot: a property
     * that can hold null passes over every row that does, and one holding something with no order
     * cannot be compared at all. The primary key is appended, so an order of the caller's own only
     * has to be one worth reading in.
     * @param cursor - The `nextCursor` of the previous page, or undefined to start the walk.
     * @param limit - How many entities to read at most.
     * @param options - Additional options including where filter etc.
     * @returns The items, how many the filter matches in total, and the cursor for the next page.
     * @throws When the order cannot be continued through, or the cursor was made for a different read.
     * @example
     * let cursor: string | undefined = undefined;
     * do {
     *     const page = await invoiceRepository.findAllAfter(cursor, 500, { where: { paid: false } });
     *     await this.remind(page.items);
     *     cursor = page.nextCursor;
     * }
     * while (cursor != undefined);
     */
    async findAllAfter(
        cursor: string | undefined,
        limit: number,
        options?: FindAllPaginatedOptions<T>
    ): Promise<KeysetPage<T>> {
        const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
        if (scoped.matchesNothing) {
            return { items: [], totalAmount: 0, nextCursor: undefined };
        }

        // resolved before the cursor is read, because the cursor is only valid for this order and
        // this filter - and because an order that cannot be continued through is the caller's
        // mistake whether or not they passed a cursor
        const driverOptions: DriverFindOptions<T> = this.toDriverFindOptions({ ...options, take: limit }, scoped.where);
        const keys: KeysetOrderKey[] = resolveKeysetOrder(this.entityClass, driverOptions.order);
        const fingerprint: string = keysetFingerprint(keys, scoped.where);

        const res: PaginationResult<T> = await this.driver.findAndCount({
            ...driverOptions,
            where: cursor == undefined
                ? scoped.where
                : afterCursorWhere(scoped.where, keysetStepsFor(decodeKeysetCursor(cursor, fingerprint), keys)),
            // the window is the rows after the cursor and the total is the rows that match at all,
            // so that a walk reports "137 of them" throughout rather than counting down. An empty
            // filter rather than none when the caller gave none: leaving it out says "the same
            // question as the window", which here is the one thing it is not
            totalWhere: cursor == undefined ? undefined : scoped.where ?? {}
        });

        await Promise.all(res.items.map(i => this.beforeReturn(i, this.entityClass, options?.autoDecrypt ?? true)));

        // a short page is the end of the walk. A page that filled up may also be, and the caller
        // hears that from the next call handing back nothing - which is one read more than counting
        // would cost and does not need the total to be exact at the moment the walk ends
        const last: T | undefined = res.items.length < limit ? undefined : res.items.at(-1);
        return {
            ...res,
            nextCursor: last == undefined
                ? undefined
                : encodeKeysetCursor({ order: fingerprint, values: keysetValuesOf(last, keys) })
        };
    }

    /**
     * Counts the entities matching the given filter, without reading any of them.
     *
     * Unlike `findAll` this has no upper bound, so how many there are stays answerable once there are
     * more of them than fit in memory.
     * @param options - The options, including the where filter and a transaction.
     * @returns How many entities match, of those the caller is allowed to see.
     */
    async count(options?: CountOptions<T>): Promise<number> {
        const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
        if (scoped.matchesNothing) {
            return 0;
        }
        return await this.driver.count({ where: scoped.where, transaction: options?.transaction });
    }

    /**
     * Whether any entity matches the given filter.
     *
     * No entity is returned, so nothing is decrypted and no relation is resolved.
     * @param options - The options, including the where filter and a transaction.
     * @returns Whether an entity the caller is allowed to see matches.
     */
    async exists(options?: CountOptions<T>): Promise<boolean> {
        const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
        if (scoped.matchesNothing) {
            return false;
        }
        // one row rather than a count, because a filter matching a million rows has to read a
        // million of them to report how many there are and the first one already answers this.
        // `find` with a limit rather than `findOne`: this is asked with no filter at all - is there
        // anything yet - and a driver may refuse to look for a single row without one
        const res: T[] = await this.driver.find({
            where: scoped.where,
            // explicit, so the entity's default relations are not joined for a row nobody reads
            relations: [],
            take: 1,
            transaction: options?.transaction
        });
        return res.length > 0;
    }

    /**
     * Updates an entity with the provided id.
     * @param id - The id of the entity to update.
     * @param data - The data to update the entity with.
     * @param options - Additional options, like a transaction.
     * @returns The updated entity.
     */
    async updateById(id: T['id'], data: UpdateData, options?: UpdateByIdOptions<T>): Promise<T> {
        // the driver's save is an upsert, so without this a row that is gone is not an error - it is
        // an insert of whatever this call happens to name, with every other column left at its
        // default. On an entity with a required column that surfaces as a constraint violation
        // blamed on an update; on one without, the row silently comes back from the dead.
        //
        // Asked without the caller's condition, and only their scope. What this read answers is
        // whether the row is there for them at all; whether the condition still holds is the write's
        // question, and checking it here as well would answer a failed condition as a missing row
        // before the write ever ran - which is the one thing a compare and set must not do.
        //
        // `exists` rather than a read, because nothing here looks at the row: it joins no relation,
        // decrypts nothing and builds no entity, where reading one did all three and threw it away.
        // The error is the one the read used to throw, and a subclass narrowing what counts as
        // present - a soft delete - narrows this the same way it narrowed that.
        if (!await this.exists({ ...options, where: { id } as Where<T> })) {
            throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
        }
        return (await this.saveUpdate(id, data, options)).entity;
    }

    /**
     * The write half of {@link updateById}, for callers that have already read the row.
     *
     * Split out so a subclass does not read the same row twice. Both subclasses need the row before
     * the write anyway - ChangeSetRepository for the change set's before state, SoftDeleteRepository
     * for its guard - and that read is the same polymorphic findById this would otherwise repeat.
     * Repositories are on the hot path of every project built on this, so a read that buys nothing
     * is worth removing.
     * Hands back the change as it was written as well as the row, because the two are not the same
     * thing: the id and whatever the save hooks fill in are added on the way, and a caller recording
     * what happened - a change set - has to see what landed rather than what was asked for.
     * @param id - The id of the entity to update.
     * @param data - The data to update the entity with.
     * @param options - Additional options, like a transaction.
     * @returns The updated entity, and the change that was written to it.
     */
    protected async saveUpdate(
        id: T['id'],
        data: UpdateData,
        options?: UpdateByIdOptions<T>
    ): Promise<WrittenUpdate<T>> {
        if (data.id != undefined) {
            this.logger.warn('Found an id on the update data, it will be ignored.');
        }

        // before anything is written or any hook runs: what this refuses is a call that was written
        // wrong, and the answer to it is a different call rather than a retry
        validateWriteIsNotBlind(this.entityClass, data, options?.where);

        // a copy, for the same reason `create` takes one: the id below and whatever `beforeSave`
        // writes are changes to the caller's object otherwise
        const own: UpdateData = { ...data, id };
        await this.beforeSave(own, SaveOperation.UPDATE, this.entityClass);
        await this.applyScopeToData(own, SaveOperation.UPDATE, options);

        // the condition is dropped for the read *after* the write, because the write is usually what
        // stops it holding - a compare and set that flips the very column it tested would otherwise
        // report the row it just changed as gone
        const findOptions: FindByIdOptions<T> = { ...options, where: undefined };
        const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
        if (scoped.matchesNothing) {
            throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
        }

        // composed rather than spread, because the condition may be an OR of several filters - the id
        // has to hold for every branch of it, which spreading an array into an object does not do
        const withId: ScopedWhere<T> = ScopeWhereUtilities.applyToWhere(
            scoped.where,
            [{ id } as WhereFilter<T>],
            MetadataUtilities.getModelProperties(this.entityClass)
        );
        if (withId.matchesNothing) {
            throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
        }

        // the condition is applied as part of the write rather than checked before it, so no other
        // caller can act between the two. Exactly one gets a row back.
        //
        // Asked for the row as well as the count, because the write is what knows what it wrote:
        // reading it afterwards is a second round trip that answers the same question, on the path
        // every update in the framework takes
        const updated: T[] = await this.driver.updateAll({
            // the id spelled out again rather than left to the composition above, because an absent
            // filter here is not "this row" - it is every row of the table
            where: withId.where ?? ({ id } as Where<T>),
            data: own,
            transaction: this.writeTransaction(options),
            returnUpdated: true
        });
        await this.validateUpdateWasWritten(updated.length, id, findOptions);

        return { entity: await this.writtenEntity(id, updated, findOptions), written: own };
    }

    /**
     * The entity an update hands back.
     *
     * What the write returned, which is the row as it now stands. A relation is the one thing it
     * cannot answer - that lives in rows beside this one rather than in a column of it - so a
     * caller who asked for relations, or an entity that reads some by default, gets the row read
     * once the write has landed.
     * @param id - The id that was updated.
     * @param updated - What the write handed back.
     * @param findOptions - The caller's options with their condition dropped, for the read that
     * resolves relations.
     * @returns The updated entity.
     * @throws When the write reported a row and returned none.
     */
    private async writtenEntity(id: T['id'], updated: T[], findOptions: FindByIdOptions<T>): Promise<T> {
        if (this.relationsToResolve(findOptions) != undefined) {
            return await this.findById(id, findOptions);
        }

        const [entity] = updated;
        if (entity == undefined) {
            throw new InternalError(`Updating one "${this.entityClass.name}" reported a written row and returned none.`);
        }
        await this.beforeReturn(entity, this.entityClass, findOptions.autoDecrypt ?? true);
        return entity;
    }

    /**
     * Refuses an update that matched no row, with the reason it matched none.
     *
     * Two things end up here and they are not the same answer. A row the caller may not see is
     * missing as far as they are concerned; a row they can see, whose condition no longer holds,
     * changed under them and is worth retrying against what it says now.
     *
     * Told apart by reading it again *without* the caller's condition and *with* the entity's scope,
     * which is the only pairing that does not turn the difference into an existence oracle: what
     * decides which answer comes back is exactly what this caller was already allowed to read.
     * @param updated - How many rows the write landed on.
     * @param id - The id that was being updated.
     * @param findOptions - The caller's options with their condition dropped, as built for the read
     * after the write.
     * @throws A conflict when the row is there and a not found when it is not. Nothing when the
     * update landed.
     */
    private async validateUpdateWasWritten(updated: number, id: T['id'], findOptions: FindByIdOptions<T>): Promise<void> {
        if (updated) {
            return;
        }
        const visible: T | undefined = await this.findById(id, { ...findOptions, required: false });
        if (visible) {
            throw new ConflictError(
                $ts`The ${this.entityClass.name} with id "${id}" changed since it was read, so the update was not applied.`
            );
        }
        throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
    }

    /**
     * Updates all entities that match the provided where filter.
     * @param where - The where filter to find the entities that should be updated.
     * @param data - The data to update the entities with.
     * @param options - Additional options, like a transaction.
     * @returns How many entities were updated, or the entities themselves when `returnUpdated` asked
     * for them.
     */
    async updateAll<R extends boolean = false>(
        where: Where<T>,
        data: UpdateData,
        options?: UpdateAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        const res: BulkUpdate<T> = await this.applyUpdateAll(where, data, options, options?.returnUpdated ?? false);
        return (options?.returnUpdated === true ? res.updates.map(u => u.entity) : res.count) as R extends true ? T[] : number;
    }

    /**
     * The write half of {@link updateAll}, for callers that need what was written to each row.
     *
     * Split out for the same reason {@link saveUpdate} hands its change back: a change set records
     * what landed, and what landed is the caller's change plus whatever the save hooks put on it.
     * One entry per row, because a bound encrypted value is encrypted for the row it lands in.
     * @param where - The where filter to find the entities that should be updated.
     * @param data - The data to update the entities with.
     * @param options - Additional options, like a transaction.
     * @returns Each updated row with the change that produced it.
     */
    protected async saveUpdateAll(
        where: Where<T>,
        data: UpdateData,
        options?: UpdateAllOptions<T, boolean>
    ): Promise<WrittenUpdate<T>[]> {
        return (await this.applyUpdateAll(where, data, options, true)).updates;
    }

    /**
     * The one implementation behind {@link updateAll} and {@link saveUpdateAll}.
     *
     * Which entities to write is decided the same way whether or not they are wanted back, and only
     * what happens after the write differs. Reading them back is the caller's decision, because a
     * bulk update is where nothing bounds what that costs - the write half of what
     * {@link UNBOUNDED_FIND_ALL_LIMIT} exists for on the read side.
     * @param where - The where filter to find the entities that should be updated.
     * @param data - The data to update the entities with.
     * @param options - Additional options, like a transaction.
     * @param returnUpdated - Whether the updated entities have to be read back. Separate from the
     * caller's own `returnUpdated`, because a change set needs them whether or not anyone asked -
     * and only the caller's ask is what the bound on handing them out is about.
     * @returns How many were updated, and each of them with its change when they were read back.
     */
    private async applyUpdateAll(
        where: Where<T>,
        data: UpdateData,
        options: UpdateAllOptions<T, boolean> | undefined,
        returnUpdated: boolean
    ): Promise<BulkUpdate<T>> {
        validateWriteIsNotBlind(this.entityClass, data, where);

        // a copy, for the reason `create` takes one
        const own: UpdateData = { ...data };
        if (own.id != undefined) {
            this.logger.warn('Found an id on the update data, it will be ignored.');
            delete own.id;
        }

        const scoped: ScopedWhere<T> = await this.scopedWhere(where, options);
        if (scoped.matchesNothing) {
            return { count: 0, updates: [] };
        }

        const boundProperties: string[] = await boundEncryptionProperties(own, this.entityClass);
        if (boundProperties.length) {
            // that branch writes a value of its own to every row, so it has them either way
            const updates: WrittenUpdate<T>[] = await this.updateAllBound(scoped.where ?? where, own, boundProperties, options);
            return { count: updates.length, updates };
        }

        await this.beforeSave(own, SaveOperation.UPDATE, this.entityClass);
        await this.applyScopeToData(own, SaveOperation.UPDATE, options);

        if (!returnUpdated) {
            const count: number = await this.inTransaction(
                options,
                async transaction => await this.driver.updateAll({ where: scoped.where ?? where, data: own, transaction })
            );
            return { count, updates: [] };
        }

        const res: T[] = await this.inTransaction(options, async transaction => {
            // counted before the write rather than after it, so a caller asking for more than fits is
            // refused while nothing has happened yet - throwing here takes the update with it
            if (options?.returnUpdated === true) {
                await this.validateReturnIsBounded(scoped.where ?? where, transaction);
            }
            const written: T[] = await this.driver.updateAll({
                where: scoped.where ?? where,
                data: own,
                transaction,
                returnUpdated: true
            });
            // inside the transaction the write ran in, because rows that are not committed yet are
            // not rows anything outside it can read
            return await this.writtenEntities(written, { ...options, transaction });
        });
        // one change for every row here, and it is the same one: this is the branch that writes a
        // single value to all of them. A copy each, because whoever records it may write to it.
        return { count: res.length, updates: res.map(entity => ({ entity, written: { ...own } })) };
    }

    /**
     * Refuses a bulk operation that was asked to hand back more entities than can be held.
     *
     * The claim {@link findAll} checks, made by a write instead of a read: a caller who wants every
     * entity a filter matches is claiming they all fit. Checked before the operation runs, so being
     * wrong costs nothing rather than a table's worth of memory.
     * @param where - The filter the operation is about to run with.
     * @param transaction - The transaction it runs in, so the count sees the state it will act on.
     */
    private async validateReturnIsBounded(where: Where<T> | undefined, transaction: Transaction | undefined): Promise<void> {
        const matching: number = await this.driver.count({ where, transaction });
        if (matching <= UNBOUNDED_FIND_ALL_LIMIT) {
            return;
        }
        throw new InternalError(
            `${this.entityClass.name}: ${matching} entities match, which is more than the ${UNBOUNDED_FIND_ALL_LIMIT}`
            + ' that can be handed back at once. Leave them unasked for to be told how many there were,'
            + ' or work through them in pages.'
        );
    }

    /**
     * The half of {@link updateAll} that cannot be one statement.
     *
     * A value bound to its row has to be encrypted for the row it lands in, so one write carrying one
     * value to every matching row is the exact thing the binding exists to forbid. Reading the rows
     * first is how this learns which ids to bind to. The write is still a single call: `save` is the
     * driver's primitive for writing many rows that each carry their own values, and is what bulk
     * creation goes through too.
     *
     * The read does widen a window that was always there. A row inserted while this is running is not
     * updated - but neither is one inserted while a plain update statement is running, at the
     * isolation level either of them gets by default. What changes is how long that window is, from
     * the length of a statement to the length of a read plus a write. A caller who needs the two to
     * be one thing hands in a transaction and picks its isolation level; both halves run inside it.
     * @param where - The filter naming the rows to update.
     * @param data - The data to update them with.
     * @param boundProperties - The properties in that data which are bound to their row.
     * @param options - Additional options, like a transaction.
     * @returns Each updated row with the change that produced it, which here really is one per row.
     */
    private async updateAllBound(
        where: Where<T>,
        data: UpdateData,
        boundProperties: string[],
        options?: UpdateAllOptions<T, boolean>
    ): Promise<WrittenUpdate<T>[]> {
        return await this.inTransaction(options, async transaction => {
            // every matching row, because every matching row is what gets written. That this has to
            // read them at all is 01-data-layer M3 - a value bound to its row cannot be written to
            // many rows in one statement, so the update really is one per row.
            //
            // Only the ids are used below, so only the ids are asked for: no relation is joined and
            // nothing is decrypted for rows that are about to be overwritten. On the path that
            // already warns about its own cost, that is the part of it nobody needed
            const rows: T[] = await this.findAll({
                where,
                ...options,
                transaction,
                take: 'all',
                relations: [],
                autoDecrypt: false
            });
            if (!rows.length) {
                return [];
            }
            if (rows.length > bulkBoundUpdateWarningThreshold) {
                this.logger.warn(
                    `Updating "${boundProperties.join('", "')}" on ${rows.length} ${this.entityClass.name} rows reads them first,`
                    + ' because the value is encrypted and bound to the row it is stored in, so each row needs its own.'
                    + ' Set "bindToRow: false" on the property if writing it in bulk is worth more than the binding.'
                );
            }

            // a copy per row, because the hook encrypts in place and every row needs a value of its
            // own - down through every object and array, since a bound property can sit in a nested
            // one. The id is what the encryption binds to, and writing it back unchanged is a no-op.
            //
            // Concurrent, which it could not be while the encryption service created its default key
            // by reading and then writing: every row arriving at once would have found no key and
            // written one. The service holds that window itself now, so the rows no longer have to
            // queue behind each other for it
            const rowData: UpdateData[] = await PromiseUtilities.allChunked(rows, async row => {
                const single: UpdateData = { ...ObjectUtilities.copyDeep(data), id: row.id };
                await this.beforeSave(single, SaveOperation.UPDATE, this.entityClass);
                await this.applyScopeToData(single, SaveOperation.UPDATE, options);
                return single;
            });

            const written: T[] = await this.driver.save(rowData, transaction, true);
            const updated: T[] = await this.writtenEntities(written, { ...options, transaction });
            // paired by id rather than by position: `rowData` was built from the rows this read, and
            // what the driver hands back is its own list. They hold the same rows, and nothing says
            // they hold them in the same order.
            return updated.map(entity => ({
                entity,
                written: rowData.find(d => d.id === entity.id) ?? { ...data, id: entity.id }
            }));
        });
    }

    /**
     * Runs the given work in the caller's transaction, or in one taken out for it.
     *
     * For operations that cannot be atomic in a single step and so need something holding across the
     * steps they do take. Callers are never required to supply a transaction for that - an operation
     * that needs one is not a reason to move the burden onto the caller - but one that was supplied
     * is used rather than nested, so the work still commits and rolls back with everything else.
     * @param options - The options the caller provided, holding their transaction if they had one.
     * @param fn - The work to run.
     * @returns Whatever the work returned.
     */
    protected async inTransaction<R>(
        options: BaseRepositoryOptions | undefined,
        fn: (transaction: Transaction) => Promise<R>
    ): Promise<R> {
        const provided: Transaction | undefined = this.writeTransaction(options);
        if (provided) {
            return await fn(provided);
        }

        const transaction: Transaction = await this.dataSource.startTransaction();
        try {
            const res: R = await fn(transaction);
            await transaction.commit();
            return res;
        }
        catch (error) {
            await transaction.rollback();
            throw error;
        }
    }

    /**
     * Deletes an entity with the provided id.
     * @param id - The id of the entity to deleted.
     * @param options - Additional options, like a transaction.
     * @returns The deleted entity.
     */
    async deleteById(id: T['id'], options?: DeleteByIdOptions): Promise<T> {
        const entityToDelete: T = await this.findById(id, options);
        await this.beforeSave(entityToDelete, SaveOperation.DELETE, this.entityClass);

        const [res] = await this.driver.remove([entityToDelete], this.writeTransaction(options));
        if (res == undefined) {
            throw new InternalError(`Removing one "${this.entityClass.name}" returned no row.`);
        }
        await this.beforeReturn(res, this.entityClass, true);
        return res;
    }

    /**
     * Deletes all entities that match the provided where filter.
     * @param where - The where filter to find the entities that should be deleted.
     * @param options - Additional options, like a transaction.
     * @returns How many entities were deleted, or the entities themselves when `returnDeleted` asked
     * for them.
     */
    async deleteAll<R extends boolean = false>(
        where: Where<T>,
        options?: DeleteAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        const res: T[] = await this.applyDeleteAll(where, options);
        return (options?.returnDeleted === true ? res : res.length) as R extends true ? T[] : number;
    }

    /**
     * The one implementation behind {@link deleteAll}.
     *
     * Unlike an update, this reads what it is about to remove whether or not the caller wants it
     * back: the delete hook runs per entity. That read is what is left of 01-data-layer M3.
     * @param where - The where filter to find the entities that should be deleted.
     * @param options - Additional options, like a transaction.
     * @returns The deleted entities.
     */
    private async applyDeleteAll(
        where: Where<T>,
        options?: DeleteAllOptions<T, boolean>
    ): Promise<T[]> {
        // before the read below rather than after it, which is the whole point: the read is what
        // would have held every matching entity at once. Scoped first, so what is counted is what
        // this caller can see rather than what the table holds
        if (options?.returnDeleted === true) {
            const scoped: ScopedWhere<T> = await this.scopedWhere(where, options);
            if (scoped.matchesNothing) {
                return [];
            }
            await this.validateReturnIsBounded(scoped.where, options.transaction);
        }

        // every matching row, because every matching row is what gets deleted. Reading them first is
        // 01-data-layer M3; what needs them is the before-save hook and the returned rows
        const toDelete: T[] = await this.findAll({ where, ...options, take: 'all' });
        await Promise.all(toDelete.map(r => this.beforeSave(r, SaveOperation.DELETE, this.entityClass)));

        const res: T[] = await this.driver.remove(toDelete, this.writeTransaction(options));
        // only for a caller who is being handed the rows. This hook decrypts and hides what an
        // entity excludes, and both are about what somebody receives - a caller counting what went
        // away receives none of it
        if (options?.returnDeleted === true) {
            await Promise.all(res.map(r => this.beforeReturn(r, this.entityClass, true)));
        }
        return res;
    }
}