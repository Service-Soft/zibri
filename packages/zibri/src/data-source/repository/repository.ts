import { AsyncLocalStorage } from 'node:async_hooks';

import { type AuthServiceInterface } from '../../auth/auth-service.interface';
import { type UserServiceInterface } from '../../auth/user/user-service.interface';
import { AlsUtilities } from '../../context/als.utilities';
import { OpenedOperationLimit, OperationLimitUtilities } from '../../context/operation-limit.utilities';
import { HttpRequestContext } from '../../context/request/http-request.context';
import { WebsocketRequestContext } from '../../context/request/websocket-request.context';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { EntityMetadata } from '../../entity/decorators/entity.decorator';
import { PropertyMetadata } from '../../entity/decorators/property.decorator';
import { EntityMetadataMissingError } from '../../entity/entity-metadata-missing.error';
import { type EntityOrder } from '../../entity/models/entity-order.model';
import { type RelationTree } from '../../entity/models/entity-relations.model';
import { EntityRelationsUtilities } from '../../entity/models/entity-relations.utilities';
import { denyAll, type DenyAll, isUnscoped } from '../../entity/models/entity-scope.model';
import { EntitySelection, Projected } from '../../entity/models/entity-selection.model';
import { EntitySelectionUtilities, SelectionTree } from '../../entity/models/entity-selection.utilities';
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
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { JsonUtilities } from '../../utilities/json.utilities';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { ObjectUtilities } from '../../utilities/object.utilities';
import { PromiseUtilities } from '../../utilities/promise.utilities';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { AggregateUtilities } from '../aggregate.utilities';
import { isSoftDeleteEntityNewable } from '../change-sets/models/is-soft-delete-entity.function';
import { type SoftDeletedRows } from '../change-sets/models/soft-deleted-rows.type';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { WhereFilterEvaluator } from '../data-sources/where-converter/where-filter.evaluator';
import { DeadlineAwareRepositoryDriver } from '../driver/deadline-aware.repository-driver';
import { type RemovalReach } from '../driver/removal-reach.model';
import { DriverFindOptions, DriverStreamOptions, RepositoryDriverInterface } from '../driver/repository-driver.interface';
import { TracedRepositoryDriver } from '../driver/traced.repository-driver';
import { WriteObservingRepositoryDriver } from '../driver/write-observing.repository-driver';
import { SaveOperation } from '../hooks/before-save';
import { RepositoryHookUtilities } from '../hooks/repository-hook.utilities';
import { afterCursorWhere, keysetStepsFor, keysetValuesOf } from '../keyset/after-cursor-where.function';
import { keysetFingerprint, KeysetOrderKey, resolveKeysetOrder } from '../keyset/keyset-order.model';
import { AggregateFunction, Aggregated, AggregateOptions, AggregateRow, GroupKeysOf, NumberKeysOf, OrderedKeysOf } from '../models/aggregate.model';
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
import { UpsertAllOptions } from '../models/options/upsert-all-options.model';
import { UpsertOptions } from '../models/options/upsert-options.model';
import { WriteRelationsOptions } from '../models/options/write-relations-options.model';
import { OwnedRelationWrite } from '../models/owned-relation-write.model';
import { OwnedRelation } from '../models/owned-relation.model';
import { KeysetPage, PaginationResult } from '../models/pagination-result.model';
import { type RelatedNarrowing } from '../models/related-narrowing.model';
import { IncrementAmounts, UpdateAllData } from '../models/update-all-data.model';
import { UpsertRow } from '../models/upsert-row.model';
import { FuzzySearchUtilities } from '../models/where/fuzzy-search.utilities';
import { Where, WhereFilter } from '../models/where/where-filter.model';
import { OwnedRelationUtilities } from '../owned-relation.utilities';
import { RelatedNarrowingUtilities } from '../scopes/related-narrowing.utilities';
import { resolveEntityScope } from '../scopes/resolve-entity-scope.function';
import { ScopedWhere, ScopeWhereUtilities } from '../scopes/scope-where.utilities';
import { TenantOwnership, TenantRowData, TenantUtilities } from '../tenancy/tenant.utilities';
import { WrittenRowTenantUtilities } from '../tenancy/written-row-tenant.utilities';
import { Transaction } from '../transaction/transaction.model';
import { UniqueConstraintViolationError } from '../unique-constraint-violation.error';
import { UpdateIncrementUtilities } from '../update-increment.utilities';
import { UpsertIdentityUtilities } from '../upsert-identity.utilities';
import { validateWriteIsNotBlind } from '../validate-write-is-not-blind.function';
import { dropImpossibleConditions } from '../where/drop-impossible-conditions.function';
import { WriteDataUtilities } from '../write-data.utilities';

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
 * What a call taking a value over rows hands on, whichever of them it is.
 */
type AggregateCallOptions<T extends BaseEntity> = BaseRepositoryOptions & {
    /**
     * The filter the rows are taken from.
     */
    where?: Where<T>,
    /**
     * The properties to take the value per group of.
     */
    groupBy?: readonly PropertyKey[]
};

/**
 * What an update that adds amounts is judged by once it is written.
 */
type IncrementJudging<T extends BaseEntity> = {
    /**
     * The scope the caller is restricted to.
     */
    scope: Where<T> | DenyAll | undefined,
    /**
     * The properties the update adds to that the scope reads.
     */
    judgedAfter: string[]
};

/**
 * One row of an upsert as it is handed to the store, with what is left to judge once it is written.
 */
type PreparedUpsert<T extends BaseEntity> = {
    /**
     * The row in the form it is stored in, and its changes on a conflict.
     */
    row: UpsertRow<T>,
    /**
     * The properties the scope reads that the conflict path adds an amount to, whose result is only
     * known once the row is written.
     */
    incremented: string[],
    /**
     * The values the conflict path sets that are encrypted bound to their row, as the caller gave
     * them. Written once the row is, since the row they bind to is the one already holding the
     * identity. Undefined when there are none.
     */
    bound: Record<string, unknown> | undefined
};

/**
 * What the conflict path of an upsert row sets, prepared the way an update prepares its values.
 */
type PreparedConflictSets<T extends BaseEntity> = {
    /**
     * The changes as the store is handed them, every value set already encrypted or hashed.
     */
    onConflict: AtomicUpdate<T>,
    /**
     * The values left out of them because they are bound to their row, or undefined when none are.
     */
    bound: Record<string, unknown> | undefined
};

/**
 * The rows written along with each written row, by its id and then by the key of their relation.
 */
type OwnedRowsById = Map<string, Map<string, BaseEntity[]>>;

/**
 * What a write giving rows of its relations hands on to every level of them.
 */
type OwnedRowsWriteOptions = BaseRepositoryOptions & Pick<WriteRelationsOptions<BaseEntity>, 'deletedRelatedRows'>;

/**
 * The property types that name another entity rather than a value stored in the row.
 */
const RELATION_TYPES: Set<string> = new Set(Object.values(Relation));

/**
 * A restriction a call of a repository resolved, and everything its answer depends on.
 */
type ResolvedRestriction<T extends BaseEntity> = {
    /**
     * The request the call ran in, whose user and membership the scope was told about.
     */
    requestContext: HttpRequestContext | WebsocketRequestContext | undefined,
    /**
     * The tenant that was active.
     */
    tenantId: string | undefined,
    /**
     * Which scopes the call was exempt from, as text.
     */
    unscoped: string,
    /**
     * Whether the call reached across tenants.
     */
    acrossTenants: boolean,
    /**
     * The restriction.
     */
    restriction: Promise<Where<T> | DenyAll | undefined>
};

/**
 * The restrictions resolved during the outermost call of a repository that is still running.
 */
type CallRestrictions<T extends BaseEntity> = {
    /**
     * Whether the call is still running. Work it started can outlive it, and resolves anew.
     */
    open: boolean,
    /**
     * What it resolved.
     */
    resolved: ResolvedRestriction<T>[]
};

/**
 * What a repository runs with: its logger and its data source.
 */
type RepositoryParts = [
    LoggerInterface,
    DataSourceInterface
];

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

    /**
     * What this repository logs through.
     */
    protected readonly logger: LoggerInterface;

    /**
     * The warnings already given about a selection that reads whole rows, so each is given once.
     */
    private readonly wholeRowSelectionWarnings: Set<string> = new Set();

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

    /**
     * The restrictions the call of this repository that is running resolved, so its every step - the
     * reads a write makes, each row of a batch - asks the scope once between them. A scope can read
     * from the data source, and asking it per row was a round trip per row.
     */
    private readonly callRestrictions: AsyncLocalStorage<CallRestrictions<T>> = new AsyncLocalStorage();

    // eslint-disable-next-line jsdoc/require-returns
    /**
     * The data source that this repository is connected to.
     */
    get dataSource(): DataSourceInterface {
        return this._dataSource;
    }

    /**
     * Builds a repository of your own on the one the data source built for the entity: it reads and
     * writes through that one, with its logger and its data source.
     * @param entityClass - The entity this repository reads and writes.
     * @param repo - The repository the data source built for it, which this class has to extend.
     */
    constructor(entityClass: Newable<T>, repo: Repository<T>);
    /**
     * Builds a repository over a driver, or over another repository with a logger or a data source
     * of its own.
     * @param entityClass - The entity this repository reads and writes.
     * @param repo - The driver, or the repository whose driver is read and written through.
     * @param logger - What the repository logs through.
     * @param dataSource - The data source the repository belongs to.
     */
    constructor(
        entityClass: Newable<T>,
        repo: RepositoryDriverInterface<T> | Repository<T>,
        logger: LoggerInterface,
        dataSource: DataSourceInterface
    );
    constructor(
        /**
         * The entity this repository reads and writes.
         */
        readonly entityClass: Newable<T>,
        repo: RepositoryDriverInterface<T> | Repository<T>,
        logger?: LoggerInterface,
        dataSource?: DataSourceInterface
    ) {
        [this.logger, this._dataSource] = Repository.resolveParts(repo, logger, dataSource);
        if (repo instanceof Repository) {
            // a repository built on a `SoftDeleteRepository` that extends plain `Repository` reads and
            // writes through the driver alone: it finds deleted rows, writes no change set and hard
            // deletes, and nothing said so
            if (!(this instanceof repo.constructor)) {
                const base: string = repo.constructor.name;
                throw new InternalError(
                    `${this.constructor.name} is built on a ${base}, so it has to extend ${base}: `
                    + 'extending anything else loses what that class adds.'
                );
            }
            // taken wrapped, so a nested repository records none of its reads twice
            this.driver = repo.driver;
        }
        else {
            // wrapped once here rather than at every call. The refusal sits outside the tracing, so
            // an operation that never reached the store leaves no span claiming it did, and the
            // observers outside it too, so that the reads they make before a write are spans of their own
            const traced: TracedRepositoryDriver<T> = new TracedRepositoryDriver(repo, entityClass);
            this.driver = new DeadlineAwareRepositoryDriver(new WriteObservingRepositoryDriver(traced, entityClass, this.logger));
        }
        ModelRegistry.get(this.entityClass);
        const metadata: EntityMetadata<T> | undefined = MetadataUtilities.getEntityMetadata(this.entityClass);
        if (!metadata) {
            throw new EntityMetadataMissingError(this.entityClass);
        }
        this.entityMetadata = metadata;
    }

    /**
     * What a repository runs with: given outright, or taken off the repository it is built on.
     * @param repo - The driver, or the repository built on.
     * @param logger - The logger given, if any.
     * @param dataSource - The data source given, if any.
     * @returns The logger and the data source.
     * @throws When something is missing and there is no repository to take it from.
     */
    protected static resolveParts<T extends BaseEntity>(
        repo: RepositoryDriverInterface<T> | Repository<T>,
        logger: LoggerInterface | undefined,
        dataSource: DataSourceInterface | undefined
    ): RepositoryParts {
        if (repo instanceof Repository) {
            return [logger ?? repo.logger, dataSource ?? repo._dataSource];
        }
        if (logger == undefined || dataSource == undefined) {
            throw new InternalError('A repository over a driver takes its logger and its data source.');
        }
        return [logger, dataSource];
    }

    /**
     * Runs on every row before it is created or updated. By default it runs the hooks provided under
     * `ZIBRI_DI_TOKENS.REPOSITORY_HOOKS`, which fill in default values, encrypt and hash. Override it
     * and call `super.beforeSave` to add to that.
     * @param data - The row, or the change to it.
     * @param operation - Whether it is created or updated.
     */
    protected async beforeSave(data: T | CreateData | UpdateData, operation: SaveOperation): Promise<void> {
        await RepositoryHookUtilities.beforeSave(data, operation, this.entityClass);
    }

    /**
     * Runs on every row before it is removed, on the row as read. By default it runs the hooks
     * provided under `ZIBRI_DI_TOKENS.REPOSITORY_HOOKS`. Override it and call `super.beforeDelete` to
     * add to that. Overriding it makes `deleteAll` read every row it removes, to hand each one over.
     * @param row - The row.
     */
    protected async beforeDelete(row: T): Promise<void> {
        await RepositoryHookUtilities.beforeDelete(row, this.entityClass);
    }

    /**
     * Runs on every row before it is handed back. By default it runs the hooks provided under
     * `ZIBRI_DI_TOKENS.REPOSITORY_HOOKS`, which decrypt and remove excluded properties. Override it
     * and call `super.beforeReturn` to add to that.
     * @param row - The row.
     * @param autoDecrypt - Whether its encrypted properties are decrypted, false only when the caller
     * asked for the stored values.
     */
    protected async beforeReturn(row: T, autoDecrypt: boolean): Promise<void> {
        await RepositoryHookUtilities.beforeReturn(row, this.entityClass, autoDecrypt);
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
    private async toDriverFindOptions<S extends EntitySelection<T> | undefined>(
        options: FindAllOptions<T, S> | FindOneOptions<T, boolean, S> | undefined,
        where: Where<T> | undefined
    ): Promise<DriverFindOptions<T>> {
        const allOptions: FindAllOptions<T, S> | undefined = options as FindAllOptions<T, S> | undefined;
        // 'all' is the absence of a limit as far as the store is concerned. The difference
        // between saying it and saying nothing is handled by findAll, which is where it matters
        const limit: number | undefined = allOptions?.limit === 'all' ? undefined : allOptions?.limit;
        this.validateCount('offset', allOptions?.offset, 0);
        this.validateCount('limit', limit, 1);
        const order: EntityOrder<T> | undefined = allOptions?.order ?? this.entityMetadata.defaultOrder;
        // here rather than in each store, so that every store refuses the same orders
        FuzzySearchUtilities.validateOrderable(order, this.entityClass);
        const relations: FindAllOptions<T>['relations'] = options?.relations ?? this.entityMetadata.defaultRelations;
        return {
            where,
            order: this.totalOrder(order, allOptions?.offset != undefined || limit != undefined),
            relations,
            related: await this.resolveRelated(where, relations, options),
            select: this.resolveColumnsToRead(options?.select, relations),
            offset: allOptions?.offset,
            limit,
            transaction: options?.transaction
        };
    }

    /**
     * Resolves which properties a read hands to the driver to read, from what the caller selected.
     *
     * The selection is refused here, before anything is read, when it names what the read cannot
     * hand back. A property whose value is decided by a function handed the whole row - an
     * `exclude`, or an encryption - makes the read take whole rows, since the narrowed one is not
     * the row it decides on; that is said once per selection, because it costs what the selection was
     * meant to save.
     * @param select - What the caller selected, if anything.
     * @param relations - The relations the read includes.
     * @returns The properties to read, or undefined for whole rows.
     */
    private resolveColumnsToRead(
        select: EntitySelection<T> | undefined,
        relations: FindAllOptions<T>['relations'] | RelationTree | undefined
    ): SelectionTree | undefined {
        const tree: SelectionTree | undefined = EntitySelectionUtilities.resolveTree(select);
        if (tree == undefined) {
            return undefined;
        }
        EntitySelectionUtilities.validateImpossibleSelect(tree, this.entityClass, EntityRelationsUtilities.resolveTree(relations));
        const needingWholeRow: string[] = EntitySelectionUtilities.findPropertiesNeedingWholeRow(tree, this.entityClass);
        if (!needingWholeRow.length) {
            return tree;
        }
        const warning: string = `Selecting ${needingWholeRow.join(', ')} reads whole rows of ${this.entityClass.name}, because what`
            + ' they hand back is decided by a function that is given the whole row (an exclude or an encryption).'
            + ' The selection still narrows what comes back, but reads as much as a read without one.';
        if (!this.wholeRowSelectionWarnings.has(warning)) {
            this.wholeRowSelectionWarnings.add(warning);
            this.logger.warn(warning);
        }
        return undefined;
    }

    /**
     * Resolves what the rows of every entity a call reaches through a relation are narrowed to.
     *
     * The rows a relation holds, a filter through it and a count of it are all answered about the
     * rows the caller may see of the related entity, the way a call on that entity's own repository
     * answers - and a call exempt from the scopes is exempt from theirs.
     * @param where - The filter of the call, already narrowed by the entity's scopes.
     * @param relations - The relations the call resolves, if any.
     * @param options - The options of the call, carrying `unscoped`.
     * @returns The narrowing per entity reached, or undefined when nothing the call reaches is narrowed.
     */
    private async resolveRelated(
        where: Where<T> | undefined,
        relations: FindAllOptions<T>['relations'] | RelationTree | undefined,
        options: BaseRepositoryOptions | undefined
    ): Promise<RelatedNarrowing | undefined> {
        const related: RelatedNarrowing = await RelatedNarrowingUtilities.resolve(
            this.entityClass,
            where,
            EntityRelationsUtilities.resolveTree(relations),
            options?.unscoped
        );
        return related.size ? related : undefined;
    }

    /**
     * Refuses a number a read is paged by that is not a whole number, or is below what it can be.
     * @param name - What the number is, for the error.
     * @param value - The number, or undefined when the read names none.
     * @param min - The smallest it can be.
     * @throws InternalError when it is not a whole number of at least `min`.
     */
    private validateCount(name: string, value: number | undefined, min: number): void {
        // refused here rather than handed to the store, where each answers it its own way: postgres
        // refuses a negative OFFSET or LIMIT, and a slice counts a negative one from the end (01 §M41)
        if (value != undefined && (!Number.isInteger(value) || value < min)) {
            throw new InternalError(
                `${this.entityClass.name}: the ${name} of a read has to be a whole number of at least ${min}, not ${value}.`
            );
        }
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
     * `defaultOrder` does not, since ordering a stream costs more than reading it: see
     * {@link StreamOptions}.
     * @param options - What the caller asked for.
     * @param where - The filter, already narrowed by the entity's scopes.
     * @returns The resolved options for the driver.
     */
    private async toDriverStreamOptions(
        options: StreamOptions<T, EntitySelection<T> | undefined> | undefined,
        where: Where<T> | undefined
    ): Promise<DriverStreamOptions<T>> {
        const relations: FindAllOptions<T>['relations'] = options?.relations ?? this.entityMetadata.defaultRelations;
        FuzzySearchUtilities.validateOrderable(options?.order, this.entityClass);
        return {
            where,
            // down to the single row, so rows an order leaves level come out the same on every store
            order: options?.order == undefined ? undefined : this.totalOrder(options.order, true),
            relations,
            related: await this.resolveRelated(where, relations, options),
            select: this.resolveColumnsToRead(options?.select, relations),
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
        const scope: Where<T> | DenyAll | undefined = await this.resolveRestriction(options);
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
     * Resolves everything a call on this entity is narrowed by: the active tenant, and the entity's
     * scopes.
     *
     * Two restrictions that both have to hold, combined into one so that everything judging a read or
     * a write against "the scope" judges it against both. The tenant is resolved apart from the scopes
     * because `unscoped` lifts the scopes alone - only `acrossTenants` reaches another tenant's rows.
     * @param options - The options the call was made with, carrying `unscoped` and `acrossTenants`.
     * @returns The filter every row the call reaches has to match, `denyAll` when none can, or
     * undefined when nothing restricts the call.
     * @throws When the entity's rows belong to a tenant and none is active, or whatever a scope throws.
     */
    private async resolveRestriction(options: BaseRepositoryOptions | undefined): Promise<Where<T> | DenyAll | undefined> {
        const call: CallRestrictions<T> | undefined = this.callRestrictions.getStore();
        if (call?.open !== true) {
            return await this.resolveRestrictionNow(options);
        }
        // everything the answer is made of, so a step that runs as somebody else, or in another
        // tenant, asks again
        const requestContext: HttpRequestContext | WebsocketRequestContext | undefined = AlsUtilities.getCurrentRequestContext();
        const tenantId: string | undefined = AlsUtilities.getCurrentTenant();
        const unscoped: string = JsonUtilities.stringify(options?.unscoped ?? false);
        const acrossTenants: boolean = options?.acrossTenants === true;
        const found: ResolvedRestriction<T> | undefined = call.resolved.find(r => r.requestContext === requestContext
            && r.tenantId === tenantId
            && r.unscoped === unscoped
            && r.acrossTenants === acrossTenants);
        if (found != undefined) {
            return await found.restriction;
        }
        const restriction: Promise<Where<T> | DenyAll | undefined> = this.resolveRestrictionNow(options);
        call.resolved.push({ requestContext, tenantId, unscoped, acrossTenants, restriction });
        return await restriction;
    }

    /**
     * Resolves the restriction of {@link resolveRestriction}, without what the call already resolved.
     * @param options - The options the call was made with, carrying `unscoped` and `acrossTenants`.
     * @returns The filter every row the call reaches has to match, `denyAll` when none can, or
     * undefined when nothing restricts the call.
     * @throws When the entity's rows belong to a tenant and none is active, or whatever a scope throws.
     */
    private async resolveRestrictionNow(options: BaseRepositoryOptions | undefined): Promise<Where<T> | DenyAll | undefined> {
        // first, so a call that should never have run outside a tenant says so before a scope refuses
        // it for want of a user
        const tenant: Where<T> | undefined = TenantUtilities.resolveRestriction(
            this.entityClass,
            this.entityMetadata,
            options?.acrossTenants
        );
        const scope: Where<T> | DenyAll | undefined = await resolveEntityScope(
            this.entityClass,
            this.entityMetadata,
            options?.unscoped
        );
        if (tenant == undefined || scope === denyAll) {
            return scope;
        }
        const combined: ScopedWhere<T> = ScopeWhereUtilities.applyToWhere(
            scope,
            tenant,
            MetadataUtilities.getModelProperties(this.entityClass)
        );
        return combined.matchesNothing ? denyAll : combined.where;
    }

    /**
     * Narrows the filter of an update or delete to the rows it may change.
     *
     * Inside a tenant a read also finds the rows of no tenant, which every tenant sees, and a write
     * leaves them alone: they change across tenants only. Applied to the reads a write makes first as
     * well, so that a row the write may not change is one it does not find.
     * @param where - The filter the write was given, if any.
     * @param options - The options of the write, carrying `acrossTenants`.
     * @returns The filter, or the note that nothing can match it.
     */
    protected resolveWriteWhere(where: Where<T> | undefined, options: BaseRepositoryOptions | undefined): ScopedWhere<T> {
        return ScopeWhereUtilities.applyToWhere(
            where,
            TenantUtilities.resolveWriteRestriction(this.entityClass, this.entityMetadata, options?.acrossTenants),
            MetadataUtilities.getModelProperties(this.entityClass)
        );
    }

    /**
     * Refuses a write that points a row at a row of another tenant, or at a row the caller may not
     * see.
     *
     * A row only ever references rows of its own tenant, and a row of no tenant only rows of none.
     * That is what keeps a read through a relation inside one tenant without narrowing it: every
     * relation between two rows was written by a call that was checked here. A row pointed at has
     * to be one the caller may see as well, the way a row they create has to be, since the rows a
     * relation holds are read back by whoever may see the row holding it. One read per entity
     * pointed at, across every row of the write.
     * @param rows - The data of each row being written, with the tenant the row belongs to.
     * @param options - The options of the write, for its transaction and `unscoped`.
     * @throws {ForbiddenError} When a row points at a row of another tenant, at one the caller may
     * not see, or at one that is not there.
     */
    private async validateReferences(rows: TenantRowData[], options: BaseRepositoryOptions | undefined): Promise<void> {
        const expected: Map<Newable<BaseEntity>, Map<string, Set<string | undefined>>> = new Map();
        for (const { data, rowTenant } of rows) {
            for (const { target, ids } of TenantUtilities.resolveReferences(data, this.entityClass, rowTenant)) {
                const byId: Map<string, Set<string | undefined>> = expected.get(target) ?? new Map<string, Set<string | undefined>>();
                for (const id of ids) {
                    byId.set(id, (byId.get(id) ?? new Set()).add(rowTenant));
                }
                expected.set(target, byId);
            }
        }

        await Promise.all([...expected].map(async ([target, byId]) => {
            // a row of no tenant pointing at rows of no tenant is what every application without
            // tenants does on every write, and there is nothing to compare - unless the rows pointed
            // at are ones this caller may not see
            const targetMetadata: EntityMetadata | undefined = MetadataUtilities.getEntityMetadata(target);
            const everyRowShared: boolean = [...byId.values()].every(tenants => tenants.size === 1 && tenants.has(undefined));
            const targetScoped: boolean = targetMetadata?.scope?.restrictedTo != undefined
                && !isUnscoped('restrictedTo', options?.unscoped);
            if (targetMetadata?.tenant === 'shared' && everyRowShared && !targetScoped) {
                return;
            }
            // a row this transaction wrote is known already, which is every row a write creates along
            // with its own - their key names the row the same write just stored
            const tenantOfId: Map<string, string | undefined> = WrittenRowTenantUtilities.findTenants(
                options?.transaction,
                target,
                [...byId.keys()]
            );
            const unknown: string[] = [...byId.keys()].filter(id => !tenantOfId.has(id));
            // through the repository of the rows pointed at, under the scopes the call is not exempt
            // from: a row the caller may not see is not there as far as they are concerned
            const found: BaseEntity[] = unknown.length
                ? await this.dataSource.getRepository(target).findAll({
                    where: { id: { oneOf: unknown } },
                    acrossTenants: true,
                    unscoped: options?.unscoped,
                    limit: 'all',
                    transaction: options?.transaction
                })
                : [];
            for (const row of found) {
                tenantOfId.set(row.id, TenantUtilities.resolveTenantOf(row, target));
            }
            for (const [id, tenants] of byId) {
                // refused alike whether the row is another tenant's, hidden from the caller or not
                // there at all, so the answer says nothing about which ids exist elsewhere
                const tenant: string | undefined = tenantOfId.get(id);
                if (!tenantOfId.has(id) || tenants.size !== 1 || !tenants.has(tenant)) {
                    throw this.resolveOutOfScopeError();
                }
            }
        }));
    }

    /**
     * Resolves the tenant the rows an update changes belong to, when the update points them at other
     * rows and so has to be checked against it.
     * @param options - The options of the update.
     * @param readRow - Reads the row being changed, when nothing else says which tenant it belongs to.
     * Absent for an update of several rows, which may belong to several tenants.
     * @returns The tenant of the changed rows, undefined for rows of no tenant.
     * @throws When an update of several rows of possibly several tenants points them at other rows.
     */
    private async resolveTenantOfUpdated(
        options: BaseRepositoryOptions | undefined,
        readRow?: () => Promise<T>
    ): Promise<string | undefined> {
        const ownership: TenantOwnership | undefined = TenantUtilities.resolveOwnership(this.entityClass, this.entityMetadata);
        if (ownership == undefined) {
            return undefined;
        }
        if (ownership.required && options?.acrossTenants !== true) {
            return AlsUtilities.getCurrentTenant();
        }
        if (readRow == undefined) {
            throw new InternalError([
                `This update of several "${this.entityClass.name}" rows points them at other rows, and they may belong to several tenants.`,
                'A row only ever points at rows of its own tenant, so update the rows of each tenant as that tenant.'
            ]);
        }
        return TenantUtilities.resolveTenantOf(await readRow(), this.entityClass);
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
        if (
            operation === SaveOperation.UPDATE
            && TenantUtilities.movesRow(data, this.entityClass, this.entityMetadata, options?.acrossTenants)
        ) {
            throw this.resolveOutOfScopeError();
        }
        const scope: Where<T> | DenyAll | undefined = await this.resolveRestriction(options);
        this.validateWithinScope(data, operation === SaveOperation.CREATE ? 'every' : Object.keys(data), scope);
    }

    /**
     * Refuses a write that would put a row outside the given, already resolved scope.
     * @param data - The data being written, as it will be stored.
     * @param judged - The properties the write decides: every one for a new row, and the ones it
     * changes for an existing row.
     * @param scope - The scope the caller is restricted to.
     * @throws When the resulting row would fall outside the scope.
     */
    private validateWithinScope(
        data: DeepPartial<T>,
        judged: 'every' | string[],
        scope: Where<T> | DenyAll | undefined
    ): void {
        if (scope == undefined) {
            return;
        }

        // narrowed the way a read is before any store sees it: every uuid in lower case, the form
        // writes store them in, and a branch no row can satisfy dropped. Judged raw, a scope spelling
        // a uuid in upper case read rows it refused to write
        const branches: WhereFilter<T>[] = scope === denyAll
            ? []
            : dropImpossibleConditions(ScopeWhereUtilities.branchesOf(scope), MetadataUtilities.getModelProperties(this.entityClass));
        // any branch, not every: the scope's branches are an OR, so a row that satisfies one of them
        // is a row the caller may see
        const allowed: boolean = branches.some(branch => {
            const applicable: WhereFilter<T> = judged === 'every'
                ? branch
                : this.conditionsOn(branch, judged);
            return this.evaluator.matches(data as T, applicable, this.entityClass);
        });

        if (!allowed) {
            throw this.resolveOutOfScopeError();
        }
    }

    /**
     * Refuses a write to a row the caller sees and may not change: inside a tenant, one of no tenant.
     * @param row - The row, as the caller found it.
     * @param options - The options of the write, carrying `acrossTenants`.
     * @throws {ForbiddenError} When the row is outside what the write may change.
     */
    private validateWritable(row: T, options: BaseRepositoryOptions | undefined): void {
        const restriction: Where<T> | undefined = TenantUtilities.resolveWriteRestriction(
            this.entityClass,
            this.entityMetadata,
            options?.acrossTenants
        );
        if (restriction == undefined || this.evaluator.matches(row, restriction, this.entityClass)) {
            return;
        }
        // forbidden rather than not found: the caller reads this row, and a row that is there to read
        // and missing to write would be the one answer that is not true
        inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).record({
            action: AuditAction.AUTHORIZATION,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.OUT_OF_SCOPE
        });
        throw new ForbiddenError(
            $ts`A ${this.entityClass.name} that belongs to no tenant is changed across tenants only.`
        );
    }

    /**
     * Records a write refused for landing outside the caller's scope, and builds the error refusing it.
     * @returns The error to throw.
     */
    private resolveOutOfScopeError(): ForbiddenError {
        // recorded, where a refused *read* is not: a read that comes back empty cannot be told apart
        // from a row that is simply not there - which is the property the 404 exists for - while a
        // write landing outside the scope is a caller stating what they intended
        inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).record({
            action: AuditAction.AUTHORIZATION,
            outcome: AuditOutcome.FAILURE,
            reason: AuditReason.OUT_OF_SCOPE
        });
        return new ForbiddenError(
            $ts`You cannot write a ${this.entityClass.name} outside what you are allowed to see.`
        );
    }

    /**
     * The part of a scope's condition that the given change actually decides.
     *
     * A change carries only the columns it writes, so judging it against a condition on a column it
     * leaves alone would refuse an ordinary update: that column already satisfied the scope, or the
     * read half would not have let this row be reached.
     * @param fragment - One branch of the scope's condition.
     * @param changed - The properties the change writes.
     * @returns The conditions on the columns the change carries.
     */
    private conditionsOn(fragment: WhereFilter<T>, changed: string[]): WhereFilter<T> {
        const res: Record<string, unknown> = {};
        for (const [property, condition] of Object.entries(fragment)) {
            if (changed.includes(property)) {
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
        return await this.withinTimeout(options, 'create', async () => {
            // the row and the rows created along with it are one write
            if (this.writeTransaction(options) == undefined && this.givesOwnedRows([data])) {
                return await this.inTransaction(options, async transaction => await this.create(data, { ...options, transaction }));
            }
            // everything below writes to what it is given - the generated id, the defaults `beforeSave`
            // fills in, whatever the driver hands back - and the caller still holds the object they
            // passed. The objects and arrays it holds as well, since the hooks reach into those too
            const own: CreateData = WriteDataUtilities.copy(data, this.entityClass);
            const [owned] = this.takeOwnedRows([own]);
            if (own.id != undefined && options?.allowId != true) {
                this.logger.warn('Found an id on the create data, it will be ignored.');
                delete own.id;
            }
            this.assignId(own);
            TenantUtilities.assignTenant(own, this.entityClass, this.entityMetadata, options?.acrossTenants);
            this.writeUuidsInLowerCase(own);
            await this.beforeSave(own, SaveOperation.CREATE);
            await this.applyScopeToData(own, SaveOperation.CREATE, options);
            await this.validateReferences(
                [{ data: own, rowTenant: TenantUtilities.resolveTenantOf(own, this.entityClass) }],
                options
            );

            const [res] = await this.writeNewRows([own], options);
            if (res == undefined) {
                throw new InternalError(`Saving one "${this.entityClass.name}" returned no row.`);
            }
            const ownedRows: OwnedRowsById = await this.writeOwnedRows(
                [[owned ?? {}, String(res.id), TenantUtilities.resolveTenantOf(own, this.entityClass)]],
                options,
                options?.allowId === true
            );

            // a write resolves the relations its own data named and knows nothing of the rest, so an
            // entity that reads one by default answered with it only when the caller happened to pass
            // it. Read once the row exists, the same way an upsert does - and *before* the hooks below,
            // because that read runs them on the row it returns and this one is about to be discarded
            const relations: FindAllOptions<T>['relations'] = this.relationsToResolve(options);
            if (relations != undefined && !this.isAnsweredByOwnedRows(relations, [res], ownedRows)) {
                return this.withOwnedRows(await this.findById(res.id, this.readBackOptions(relations, options)), ownedRows);
            }

            await this.beforeReturn(res,true);
            return this.withOwnedRows(res, ownedRows);
        });
    }

    /**
     * Whether the data of some rows gives a value for a one to many or has one relation.
     * @param rows - The data of the rows.
     * @returns True when one of them does.
     */
    private givesOwnedRows(rows: DeepPartial<T>[]): boolean {
        return OwnedRelationUtilities.resolveAll(this.entityClass).some(r => rows.some(row => Reflect.get(row, r.key) !== undefined));
    }

    /**
     * Takes the values of the one to many and has one relations off the data of the rows being
     * written.
     *
     * Before anything else runs on the data: those rows are written through the repository of their
     * own entity once these exist, which runs its hooks, scope, change sets and tenancy on them. Left
     * on, this repository's hooks would have run on them as well, encrypting a value twice.
     * @param rows - The data of the rows, which loses those values.
     * @returns The values taken off each row, in the order of the rows.
     */
    private takeOwnedRows(rows: DeepPartial<T>[]): Record<string, unknown>[] {
        const relations: OwnedRelation[] = OwnedRelationUtilities.resolveAll(this.entityClass);
        return rows.map(row => {
            const taken: Record<string, unknown> = {};
            for (const relation of relations) {
                const value: unknown = Reflect.get(row, relation.key);
                if (value !== undefined) {
                    taken[relation.key] = value;
                    Reflect.deleteProperty(row, relation.key);
                }
            }
            return taken;
        });
    }

    /**
     * Writes the rows of the one to many and has one relations that written rows gave a value for,
     * through the repository of their entity, as {@link OwnedRelationUtilities} resolves it: rows the
     * value leaves out are deleted or unlinked, rows without an id created, and rows with one updated.
     *
     * Each row given with an id is updated on its own, because each carries values of its own - and
     * finding it is what checks that it is a row the caller may write. Where the write allows ids, a
     * row given with an id no row has yet is created with it instead. A soft deleted one is restored
     * along with it where the write or the relation says so, and refused otherwise.
     * @param entries - The values taken off each written row, with an `id` when the row was updated,
     * the id it was written under and the tenant it belongs to.
     * @param options - The options of the write, holding the transaction it runs in.
     * @param allowId - Whether the write allows choosing ids, as `create` with `allowId` does.
     * @returns The rows written along with each row, by its id and the relation's key.
     */
    private async writeOwnedRows(
        entries: [Record<string, unknown>, string, string | undefined][],
        options: OwnedRowsWriteOptions | undefined,
        allowId: boolean
    ): Promise<OwnedRowsById> {
        // the check the row's own data went through, which gives a row created along with it the
        // row's tenant and refuses linking one of another tenant
        await this.validateReferences(entries.map(([data, , rowTenant]) => ({ data, rowTenant })), options);
        const res: OwnedRowsById = new Map();
        const childOptions: OwnedRowsWriteOptions = {
            transaction: this.writeTransaction(options),
            acrossTenants: options?.acrossTenants,
            // the scopes an array names are this entity's own, which the other entity does not have
            unscoped: options?.unscoped === true ? true : undefined,
            deletedRelatedRows: options?.deletedRelatedRows
        };
        const relations: OwnedRelation[] = OwnedRelationUtilities.resolveAll(this.entityClass);
        const values: [Record<string, unknown>, string][] = entries.map(([data, id]) => [data, id]);
        for (const write of OwnedRelationUtilities.resolveWrites(relations, values)) {
            const { relation, rows, ownerIds }: OwnedRelationWrite = write;
            const repository: Repository<BaseEntity> = this.dataSource.getRepository(relation.target);

            const leftOutWhere: Where<BaseEntity> | undefined = OwnedRelationUtilities.resolveLeftOutWhere(write);
            if (leftOutWhere != undefined && relation.leftOut === 'delete') {
                // whatever their locked properties hold: the save that leaves them out decides it
                await repository.deleteAll(ModelRegistry.get(relation.target).optimisticLockDescriptor.resolveRegardlessWhere(leftOutWhere), childOptions);
            }
            if (leftOutWhere != undefined && relation.leftOut === 'unlink') {
                // null rather than undefined, which an update reads as "leave this column alone"
                // eslint-disable-next-line unicorn/no-null
                await repository.updateAll(leftOutWhere, { [relation.foreignKey]: null }, childOptions);
            }

            const given: DeepPartial<BaseEntity>[] = rows.filter(r => r.id != undefined);
            const newIds: Set<string> = allowId
                ? await this.findMissingIds(relation.target, given.map(r => String(r.id)), childOptions.transaction)
                : new Set();
            const created: BaseEntity[] = await repository.createAll(
                rows.filter(r => r.id == undefined || newIds.has(String(r.id))),
                { ...childOptions, allowId }
            );
            // all at once, each with its own values - and found by the write, so the scope applies.
            // Restoring is writing each as a restore does, over the soft deleted rows as well; the
            // rows that are not deleted are written the same either way, so none is read first
            const stored: DeepPartial<BaseEntity>[] = given.filter(r => !newIds.has(String(r.id)));
            const restores: boolean = isSoftDeleteEntityNewable(relation.target)
                && (options?.deletedRelatedRows ?? relation.deletedRows) === 'restore';
            const restoring: OwnedRowsWriteOptions & { deleted: SoftDeletedRows } = { ...childOptions, deleted: 'include' };
            const updated: BaseEntity[] = (restores
                ? await repository.updateEach(stored.map(r => ({ ...r, deleted: false })), restoring)
                : await repository.updateEach(stored, childOptions)
            ).map(u => u.entity);

            for (const ownerId of ownerIds) {
                const owned: Map<string, BaseEntity[]> = res.get(ownerId) ?? new Map<string, BaseEntity[]>();
                owned.set(relation.key, []);
                res.set(ownerId, owned);
            }
            // pushed onto each owner's list rather than copying it per row, which is the square of
            // the rows of one owner (evaluation/01-data-layer M43)
            for (const row of [...created, ...updated]) {
                res.get(String(Reflect.get(row, relation.foreignKey)))
                    ?.get(relation.key)
                    ?.push(row);
            }
        }
        return res;
    }

    /**
     * Finds which of the given ids no row of an entity holds, whoever may see it.
     * @param target - The entity.
     * @param ids - The ids.
     * @param transaction - The transaction of the write.
     * @returns The ids no row holds.
     */
    private async findMissingIds(target: Newable<BaseEntity>, ids: string[], transaction: Transaction | undefined): Promise<Set<string>> {
        if (!ids.length) {
            return new Set();
        }
        const options: FindAllOptions<BaseEntity> = {
            where: { id: { oneOf: ids } },
            limit: 'all',
            relations: [],
            autoDecrypt: false,
            unscoped: true,
            acrossTenants: true,
            transaction
        };
        // a row that is only marked deleted still holds its id
        const found: BaseEntity[] = isSoftDeleteEntityNewable(target)
            ? await this.dataSource.getRepository(target).findAll({ ...options, deleted: 'include' })
            : await this.dataSource.getRepository(target).findAll(options);
        const existing: Set<string> = new Set(found.map(f => String(f.id)));
        return new Set(ids.filter(id => !existing.has(id)));
    }

    /**
     * Whether the relations written rows are handed back with are answered by the rows the same write
     * wrote along with them, so that nothing has to be read.
     *
     * Only a one to many or has one relation the data of every row gave a value for, and nothing
     * below it: the rows beside those were not part of the write.
     * @param relations - The relations to hand the rows back with.
     * @param written - The written rows.
     * @param ownedRows - The rows written along with each row, by its id.
     * @returns True when the rows at hand answer every relation, which an empty list of them always is.
     */
    private isAnsweredByOwnedRows(relations: FindAllOptions<T>['relations'], written: T[], ownedRows: OwnedRowsById): boolean {
        const tree: RelationTree = EntityRelationsUtilities.resolveTree(relations);
        return [...tree].every(([key, below]) => !below.size && written.every(row => ownedRows.get(String(row.id))?.has(key) === true));
    }

    /**
     * Puts the rows written along with a row on it, where nothing read them already.
     * @param entity - The written row, as it is handed back.
     * @param ownedRows - The rows written along with each row, by its id.
     * @returns The same entity.
     */
    private withOwnedRows(entity: T, ownedRows: OwnedRowsById): T {
        const relations: OwnedRelation[] = OwnedRelationUtilities.resolveAll(this.entityClass);
        for (const [key, rows] of ownedRows.get(entity.id) ?? []) {
            if (Reflect.get(entity, key) === undefined) {
                Reflect.set(entity, key, relations.some(r => r.key === key && r.holdsOne) ? rows.at(0) : rows);
            }
        }
        return entity;
    }

    /**
     * The options a write reads its row back with, reaching what the write reached.
     * @param relations - The relations to hand the row back with.
     * @param options - What the write was called with.
     * @returns The options of the read.
     */
    private readBackOptions(
        relations: FindAllOptions<T>['relations'],
        options: CreateOptions<T> | UpsertOptions<T> | undefined
    ): FindByIdOptions<T> {
        return { relations, transaction: options?.transaction, unscoped: options?.unscoped, acrossTenants: options?.acrossTenants };
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
     *
     * On an entity with a scope, the update only ever applies to a row the caller may see. When the
     * identity is held by a row they may not see, the call is refused with the same
     * `UniqueConstraintViolationError` inserting that identity would be. A change that would move the
     * row out of what the caller may see is refused with a `ForbiddenError`, as it is on an update. An
     * increment is judged once the row is written, since its result depends on what is stored, and
     * rolled back with it. Inside a transaction you passed, that write stays until you roll the
     * transaction back.
     *
     * A property declaring `optimisticLocking` that `onConflict` sets has to be named in the `where`
     * of the options, as on an update. The row holding the identity has to match that `where` for the
     * changes to apply, and when it does not, the call fails with a `ConflictError`. An `increment`
     * needs no condition, since it adds to whatever is stored.
     * @param identity - The properties identifying the row, and their values. They have to be the
     * values `create` holds, and `onConflict` leaves them as they are.
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
        return await this.withinTimeout(options, 'upsert', async () => {
            const identityKeys: string[] = Object.keys(identity);
            // resolved once for every question below, rather than once per question
            const scope: Where<T> | DenyAll | undefined = await this.resolveRestriction(options);
            const conflictKeys: string[] = this.withTenantKey(identityKeys, [create]);
            const prepared: PreparedUpsert<T> = await this.prepareUpsert(
                conflictKeys,
                { create, onConflict, where: options?.where },
                scope,
                options?.acrossTenants
            );

            // a store finds the row by what it inserts, so an identity naming other values would be a
            // lookup of one row and an insert of another
            const given: string = UpsertIdentityUtilities.resolveValues(
                identityKeys,
                Object.assign({ ...identity }, UUIDUtilities.resolveCanonicalChanges(identity, this.entityClass))
            );
            if (given !== UpsertIdentityUtilities.resolveValues(identityKeys, prepared.row.create)) {
                throw new InternalError(
                    `upsert on "${this.entityClass.name}" was given an identity whose values differ from the ones its create data holds.`
                );
            }

            const [res] = await this.runUpsert(conflictKeys, [prepared], scope, options);
            if (res == undefined) {
                throw new InternalError(`An upsert of one "${this.entityClass.name}" returned no row.`);
            }

            const relations: FindAllOptions<T>['relations'] = this.relationsToResolve(options);
            if (relations != undefined) {
                // read once the row exists, rather than as part of writing it. An upsert used to hand
                // back a row with its relations missing while the property was not typed optional, so
                // reading through one was a TypeError on an entity every other read returns resolved.
                // That read runs the hooks below on the row it returns, so this one skips them
                return await this.findById(res.id, this.readBackOptions(relations, options));
            }

            await this.beforeReturn(res,true);
            return res;
        });
    }

    /**
     * Inserts each row, or applies its changes to the row that already holds its identity, with no
     * window for another writer to interleave in.
     *
     * The batch form of {@link upsert}, and every rule of that one applies to each row here. The
     * identity is named once and read off each row's `create`, and each row brings its own
     * `onConflict`, so each can set or add something different.
     *
     * No two rows may hold the same identity. Such a batch is refused before anything is written,
     * since one of the two would have to decide what the other does.
     *
     * On an entity with a scope the batch is all or nothing: when one row is refused, none of the
     * others are written either.
     * @param identity - The properties identifying each row. `onConflict` leaves them as they are.
     * @param rows - Each row to insert when nothing holds its identity yet, and the changes to apply
     * when a row already does.
     * @param options - Additional options, eg. A transaction. The result is returned before the
     * transaction commits, and is rolled back with it.
     * @returns The rows as they are after the insert or the update, in the order they were given, with
     * their relations resolved.
     */
    async upsertAll(
        identity: Extract<keyof T, string>[],
        rows: UpsertRow<T, CreateData>[],
        options?: UpsertAllOptions<T>
    ): Promise<T[]> {
        return await this.withinTimeout(options, 'upsertAll', async () => {
            if (!rows.length) {
                return [];
            }
            const scope: Where<T> | DenyAll | undefined = await this.resolveRestriction(options);
            const conflictKeys: string[] = this.withTenantKey(identity, rows.map(row => row.create));
            const prepared: PreparedUpsert<T>[] = await Promise.all(
                rows.map(row => this.prepareUpsert(conflictKeys, row, scope, options?.acrossTenants))
            );

            // refused here rather than left to the store, where one answers with an error of its own
            // and another would apply both rows one after the other - and the second row's change
            // would then be decided by the first
            const seen: Set<string> = new Set();
            for (const p of prepared) {
                const values: string = UpsertIdentityUtilities.resolveValues(conflictKeys, p.row.create);
                if (seen.has(values)) {
                    throw new InternalError([
                        `upsertAll on "${this.entityClass.name}" was given the identity ${values} more than once.`,
                        'Each identity names one row, so each may appear once.'
                    ]);
                }
                seen.add(values);
            }

            const res: T[] = await this.runUpsert(conflictKeys, prepared, scope, options);
            return await this.writtenEntities(res, options);
        });
    }

    /**
     * The properties an upsert's identity is resolved by, the tenant included.
     *
     * Every unique of a tenant's entity is led by the tenant, so the identity a caller names is unique
     * only together with it - and the row it names is the one of the tenant the call acts in. Rows of
     * no tenant hold no value to lead with, and are unique among themselves by the identity alone.
     * @param identity - The properties the caller named.
     * @param creates - The rows being upserted, as the caller passed them.
     * @returns Those properties, with the tenant property in front when the rows belong to a tenant.
     * @throws When some of the rows belong to a tenant and some to none.
     */
    private withTenantKey(identity: string[], creates: CreateData[]): string[] {
        const ownership: TenantOwnership | undefined = TenantUtilities.resolveOwnership(this.entityClass, this.entityMetadata);
        if (ownership == undefined || identity.includes(ownership.property)) {
            return identity;
        }
        const led: string[] = [ownership.property, ...identity];
        if (ownership.required) {
            return led;
        }
        // as each row will be written: a row naming no tenant gets the active one, see assignTenant
        const ofTenant: boolean[] = creates.map(
            create => (TenantUtilities.resolveTenantOf(create, this.entityClass) ?? AlsUtilities.getCurrentTenant()) != undefined
        );
        if (ofTenant.every(Boolean)) {
            return led;
        }
        if (!ofTenant.some(Boolean)) {
            return identity;
        }
        throw new InternalError([
            `This upsert on "${this.entityClass.name}" holds rows of a tenant and rows of no tenant.`,
            'Each of the two is unique by a key of its own, so upsert them in separate calls.'
        ]);
    }

    /**
     * Prepares one row of an upsert for the store: copied, given an id, passed through the save hooks
     * and judged against the scope as far as it can be before anything is written.
     * @param identity - The properties identifying the row.
     * @param row - The row as the caller passed it.
     * @param scope - The scope the caller is restricted to.
     * @param acrossTenants - Whether or not the upsert should happen across tenants.
     * @returns The row as it is handed to the store, and what is left to judge once it is written.
     * @throws When the row lands outside the scope, or its identity cannot be read off it.
     */
    private async prepareUpsert(
        identity: string[],
        row: UpsertRow<T, CreateData>,
        scope: Where<T> | DenyAll | undefined,
        acrossTenants: boolean | undefined
    ): Promise<PreparedUpsert<T>> {
        // the conflict path is an update, and is refused as a blind one before anything is written or
        // any hook runs. Only what it sets: an increment adds to whatever is stored, so a write that
        // landed in between is kept rather than lost
        validateWriteIsNotBlind(this.entityClass, this.resolveConflictSets(row.onConflict), row.where);

        // a copy, for the reason `create` takes one. An id the caller chose is kept either way -
        // `assignId` fills one in only when there is none - what changes is that a *generated* id
        // lands here rather than on the object the caller still holds.
        const own: CreateData = WriteDataUtilities.copy(row.create, this.entityClass);
        this.assignId(own);
        TenantUtilities.assignTenant(own, this.entityClass, this.entityMetadata, acrossTenants);
        this.writeUuidsInLowerCase(own);
        await this.beforeSave(own, SaveOperation.CREATE);
        this.validateWithinScope(own, 'every', scope);
        const onConflict: AtomicUpdate<T> = this.resolveOnConflictInLowerCase(row.onConflict);

        // the conflict path is an update of the row the identity names, and is judged as one - on the
        // columns it writes that the scope reads. A value it sets is known now, so it is judged now,
        // before anything is written
        const set: Record<string, unknown> = {};
        const incremented: string[] = [];
        for (const [key, change] of ObjectUtilities.entries(onConflict)) {
            if (change == undefined || !this.scopeReads(scope, key)) {
                continue;
            }
            if ('increment' in change) {
                incremented.push(key);
                continue;
            }
            set[key] = change.set;
        }
        this.validateWithinScope(Object.assign({ ...own }, set), Object.keys(set), scope);

        // before the driver, so that both stores answer the same way. Postgres builds one statement
        // out of the create data and had no column to put a relation in; valkey resolves a to-one
        // relation to its foreign key while saving and quietly accepted what postgres threw on
        this.writeRelationsAsForeignKeys(own);

        // after the scope has judged the values as they were given, since what it compares is what the
        // caller said rather than its ciphertext
        const sets: PreparedConflictSets<T> = await this.prepareConflictSets(identity, own, onConflict);
        const prepared: UpsertRow<T> = { create: own, onConflict: sets.onConflict, where: this.resolveConflictCondition(row.where) };
        this.validateUpsertIdentity(identity, prepared);
        return { row: prepared, incremented, bound: sets.bound };
    }

    /**
     * Prepares what the conflict path of an upsert row sets the way an update prepares its values:
     * through the save hook, so that a value is encrypted and hashed as on any other write.
     *
     * A value encrypted bound to its row is encrypted for the row it lands in, which on the conflict
     * path is the row already holding the identity - not known until the row is written. Those are
     * left out here and written by `writeBoundConflictSets` once it is.
     * @param identity - The properties identifying the row.
     * @param create - The row to insert, as it is handed to the store.
     * @param onConflict - The changes as the caller gave them.
     * @returns The changes as the store is handed them, and the values left out of them.
     */
    private async prepareConflictSets(
        identity: string[],
        create: CreateData,
        onConflict: AtomicUpdate<T>
    ): Promise<PreparedConflictSets<T>> {
        const sets: Record<string, unknown> = this.resolveConflictSets(onConflict);
        if (!Object.keys(sets).length) {
            return { onConflict, bound: undefined };
        }
        const boundKeys: Set<string> = new Set(
            (await boundEncryptionProperties(sets, this.entityClass)).map(path => path.split('.')[0] ?? path)
        );

        // a bare instance of the entity rather than an object literal, so the hook is handed what it
        // is typed for and nothing besides the values set. Copied, for the reason `create` copies
        // eslint-disable-next-line typescript/no-unsafe-assignment, typescript/no-unsafe-argument
        const unbound: T = Object.assign(Object.create(this.entityClass.prototype), WriteDataUtilities.copy(sets, this.entityClass));
        for (const key of boundKeys) {
            Reflect.deleteProperty(unbound, key);
        }
        await this.beforeSave(unbound, SaveOperation.UPDATE);

        const res: AtomicUpdate<T> = { ...onConflict };
        const bound: Record<string, unknown> = {};
        for (const key of Object.keys(sets)) {
            if (boundKeys.has(key)) {
                bound[key] = sets[key];
                Reflect.deleteProperty(res, key);
                continue;
            }
            Reflect.set(res, key, { set: Reflect.get(unbound, key) });
        }
        // a store only takes a conflict path that changes something. Setting a property of the
        // identity to the value it holds changes nothing, and keeps the path for the bound values
        const [first] = identity;
        if (!Object.values(res).some(change => change != undefined) && first != undefined) {
            Reflect.set(res, first, { set: Reflect.get(create, first) });
        }
        return { onConflict: res, bound: boundKeys.size ? bound : undefined };
    }

    /**
     * Writes the values the conflict path of an upsert sets that are encrypted bound to their row, to
     * the rows the conflict path ran on - now that it is known which rows those are.
     *
     * Part of the transaction the upsert ran in. A `set` overwrites whatever is stored, so writing it
     * after the rest of the change loses nothing the single statement kept.
     * @param prepared - The rows as they were prepared.
     * @param written - The rows the store wrote, in the same order. Replaced by what this writes.
     * @param transaction - The transaction the upsert runs in.
     */
    private async writeBoundConflictSets(prepared: PreparedUpsert<T>[], written: T[], transaction: Transaction): Promise<void> {
        const rows: T[] = [];
        for (const [i, p] of prepared.entries()) {
            const entity: T | undefined = written[i];
            // the conflict path ran when the row written is not the one the insert would have made
            if (p.bound == undefined || entity == undefined || entity.id === Reflect.get(p.row.create, 'id')) {
                continue;
            }
            // eslint-disable-next-line typescript/no-unsafe-assignment
            const single: T = Object.assign(
                // eslint-disable-next-line typescript/no-unsafe-argument
                Object.create(this.entityClass.prototype),
                WriteDataUtilities.copy(p.bound, this.entityClass),
                { id: entity.id }
            );
            await this.beforeSave(single, SaveOperation.UPDATE);
            rows.push(single);
        }
        if (!rows.length) {
            return;
        }
        const updated: T[] = await this.driver.updateEach(rows, { id: { oneOf: rows.map(r => r.id) } } as Where<T>, transaction);
        for (const entity of updated) {
            const at: number = written.findIndex(w => w.id === entity.id);
            if (at !== -1) {
                written[at] = entity;
            }
        }
    }

    /**
     * The condition the conflict path of an upsert row is applied under, as the store is handed it.
     * @param where - The condition the caller gave, if any.
     * @returns The condition, narrowed to what a row can hold, or undefined when it asks nothing of
     * the row.
     */
    private resolveConflictCondition(where: Where<T> | undefined): Where<T> | undefined {
        const branches: WhereFilter<T>[] = ScopeWhereUtilities.branchesOf(where);
        // a property named with no value is how a caller says they overwrite regardless, so a branch
        // naming nothing else asks nothing of the row - and an OR holding such a branch asks nothing
        if (branches.some(branch => Object.values(branch).every(value => value === undefined))) {
            return undefined;
        }
        // narrowed as a read's filter is, so a value the property cannot hold is a condition no row
        // meets rather than one a store refuses to compare against
        const possible: WhereFilter<T>[] = dropImpossibleConditions(branches, MetadataUtilities.getModelProperties(this.entityClass));
        if (!possible.length) {
            return { id: { oneOf: [] } } as Where<T>;
        }
        return possible.length === 1 ? possible[0] : possible;
    }

    /**
     * Writes every uuid the data holds in lower case, the form every data source stores it in -
     * including those of the related rows it names.
     * @param data - The data about to be written, changed in place. A related row that changes is
     * replaced by a copy.
     */
    private writeUuidsInLowerCase(data: CreateData | UpdateData): void {
        // before `beforeSave`, because encryption binds a value to the id of its row and the id has to
        // be the one that is stored
        Object.assign(data, UUIDUtilities.resolveCanonicalChanges(data, this.entityClass));
    }

    /**
     * The conflict changes of an upsert with every uuid they set in lower case.
     * @param onConflict - The changes as the caller passed them.
     * @returns A copy when a value changed, otherwise the changes as they are.
     */
    private resolveOnConflictInLowerCase(onConflict: AtomicUpdate<T>): AtomicUpdate<T> {
        const changed: [string, unknown][] = Object.entries(
            UUIDUtilities.resolveCanonicalChanges(this.resolveConflictSets(onConflict), this.entityClass)
        );
        if (!changed.length) {
            return onConflict;
        }
        return Object.assign({ ...onConflict }, Object.fromEntries(changed.map(([key, value]) => [key, { set: value }])));
    }

    /**
     * The values the conflict changes of an upsert set, leaving out the amounts they add.
     * @param onConflict - The changes.
     * @returns The value each property is set to, by property.
     */
    private resolveConflictSets(onConflict: AtomicUpdate<T>): Record<string, unknown> {
        const sets: Record<string, unknown> = {};
        for (const [key, change] of ObjectUtilities.entries(onConflict)) {
            if (change != undefined && 'set' in change) {
                sets[key] = change.set;
            }
        }
        return sets;
    }

    /**
     * Refuses an upsert row whose identity cannot be read off it, or that its changes would move.
     * @param identity - The properties identifying the row.
     * @param row - The row as it is handed to the store.
     * @throws When the row holds no value for a property of the identity, or changes one.
     */
    private validateUpsertIdentity(identity: string[], row: UpsertRow<T>): void {
        const values: Map<string, unknown> = new Map(Object.entries(row.create));
        const changes: Map<string, unknown> = new Map(Object.entries(row.onConflict));
        for (const key of identity) {
            const value: unknown = values.get(key);
            if (value == undefined) {
                throw new InternalError(
                    `upsert on "${this.entityClass.name}" was given no value for "${key}", which is part of its identity.`
                );
            }
            // the identity is what the conflicting row was found by and what the written row is
            // paired back to its caller's row by. Setting it to what it already is changes neither
            const change: unknown = changes.get(key);
            const keepsIt: boolean = change == undefined
                || (
                    typeof change === 'object'
                    && 'set' in change
                    && JsonUtilities.stringify(change.set) === JsonUtilities.stringify(value)
                );
            if (!keepsIt) {
                throw new InternalError([
                    `upsert on "${this.entityClass.name}" changes "${key}" on a conflict, which is part of its identity.`,
                    'The identity names the row being changed, so a change to it would land the row on one nobody checked.'
                ]);
            }
        }
    }

    /**
     * Hands prepared upsert rows to the store, in a transaction when anything about them can only be
     * judged once they are written.
     * @param identity - The properties identifying each row.
     * @param prepared - The rows, as `prepareUpsert` left them.
     * @param scope - The scope the caller is restricted to.
     * @param options - The caller's options, holding their transaction if they had one.
     * @returns The written rows, in the order they were given.
     * @throws When a row lands outside the scope.
     */
    private async runUpsert(
        identity: string[],
        prepared: PreparedUpsert<T>[],
        scope: Where<T> | DenyAll | undefined,
        options: BaseRepositoryOptions | undefined
    ): Promise<T[]> {
        const rows: UpsertRow<T>[] = prepared.map(p => p.row);
        const reachable: Where<T> | undefined = this.resolveReachableByUpsert(identity, rows, scope);
        // what the scope and the rows' own conditions reach through relations, judged over the rows
        // the caller may see of them
        const related: RelatedNarrowing | undefined = await this.resolveRelated(
            [...ScopeWhereUtilities.branchesOf(reachable), ...rows.flatMap(row => ScopeWhereUtilities.branchesOf(row.where))],
            undefined,
            options
        );
        // the conflicting row holds the same identity, the tenant included, so both paths point a row
        // of the create data's tenant at whatever either of them names
        await this.validateReferences(
            rows.map(row => ({
                data: Object.assign({ ...row.create }, this.resolveConflictSets(row.onConflict)),
                rowTenant: TenantUtilities.resolveTenantOf(row.create, this.entityClass)
            })),
            options
        );

        // an amount a row adds is not known until it lands, since what it adds to is whatever is
        // stored - so that half is judged on the written row, in a transaction that rolls it back
        // when it left the caller's reach. And a row the store refuses can come after rows it has
        // already written, so a restricted batch of several is held together the same way. Inside
        // the caller's own transaction it stays until they roll back on the error. Only a scope
        // keyed on a counter, or a scoped batch, pays for the transaction
        const judgedAfter: boolean = prepared.some(p => p.incremented.length);
        // a row's own condition refuses it the way the scope does, so a batch holding one is held
        // together the same way
        const refusedPartway: boolean = (reachable != undefined || rows.some(row => row.where != undefined)) && rows.length > 1;
        // a value bound to its row is written after the row, and the two are one write
        const writtenAfter: boolean = prepared.some(p => p.bound != undefined);
        try {
            if (!judgedAfter && !refusedPartway && !writtenAfter) {
                return await this.driver.upsert(identity, rows, this.writeTransaction(options), reachable, related);
            }
            return await this.inTransaction(options, async transaction => {
                const written: T[] = await this.driver.upsert(identity, rows, transaction, reachable, related);
                await this.writeBoundConflictSets(prepared, written, transaction);
                for (const [i, entity] of written.entries()) {
                    const incremented: string[] = prepared[i]?.incremented ?? [];
                    if (incremented.length) {
                        this.validateWithinScope(entity, incremented, scope);
                    }
                }
                return written;
            });
        }
        catch (error) {
            await this.validateConditionsHeld(error, identity, rows, options);
            throw error;
        }
    }

    /**
     * Refuses with a conflict an upsert that the store refused because a row's condition no longer
     * held.
     *
     * The store answers a row it may not change the same way whether the scope or the caller's
     * condition excluded it: as inserting the identity would be answered. Told apart the way an update
     * tells them apart, by reading the row holding the identity through the scope and without the
     * condition, so what decides the answer is what this caller was already allowed to read. A row
     * they may see that no longer matches changed under them; one they may not see keeps the answer
     * the store gave.
     * @param error - What the store threw.
     * @param identity - The properties identifying each row.
     * @param rows - The rows as they were handed to the store.
     * @param options - The caller's options, holding their transaction if they had one.
     * @throws A `ConflictError` when a row the caller may see no longer matches its condition.
     */
    private async validateConditionsHeld(
        error: unknown,
        identity: string[],
        rows: UpsertRow<T>[],
        options: BaseRepositoryOptions | undefined
    ): Promise<void> {
        const conditioned: UpsertRow<T>[] = rows.filter(row => row.where != undefined);
        if (!(error instanceof UniqueConstraintViolationError) || !conditioned.length) {
            return;
        }
        const held: T[] = await this.findAll({
            where: conditioned.flatMap(row => ScopeWhereUtilities.branchesOf(
                UpsertIdentityUtilities.resolveConflictWhere(this.entityClass, identity, row.create)
            )),
            transaction: options?.transaction,
            unscoped: options?.unscoped,
            acrossTenants: options?.acrossTenants,
            relations: [],
            limit: 'all'
        });
        for (const row of conditioned) {
            const values: string = UpsertIdentityUtilities.resolveValues(identity, row.create);
            const found: T | undefined = held.find(h => UpsertIdentityUtilities.resolveValues(identity, h) === values);
            if (found != undefined && row.where != undefined && !this.evaluator.matches(found, row.where, this.entityClass)) {
                throw new ConflictError(
                    $ts`The ${this.entityClass.name} holding ${values} changed since it was read, so the upsert was not applied.`
                );
            }
        }
    }

    /**
     * The rows the conflict path of an upsert may apply to: the ones the caller may see.
     *
     * Not a filter the repository can add to the identity the way a scope is added to a where filter.
     * The identity is also the conflict target and has to be a declared unique group, so a row the
     * caller may not see still holds it - which is why the store is handed this to judge that row by.
     * @param identity - The properties identifying each row.
     * @param rows - The rows being upserted, holding the identities' values.
     * @param scope - The scope the caller is restricted to.
     * @returns The filter, or undefined when the caller is not restricted.
     * @throws When the identities themselves name nothing the caller may see.
     */
    private resolveReachableByUpsert(
        identity: string[],
        rows: UpsertRow<T>[],
        scope: Where<T> | DenyAll | undefined
    ): Where<T> | undefined {
        if (scope == undefined) {
            return undefined;
        }
        const reachable: ScopedWhere<T> = scope === denyAll
            ? { matchesNothing: true, where: undefined }
            : ScopeWhereUtilities.applyToWhere(
                rows.flatMap(row => ScopeWhereUtilities.branchesOf(
                    UpsertIdentityUtilities.resolveConflictWhere(this.entityClass, identity, row.create)
                )),
                scope,
                MetadataUtilities.getModelProperties(this.entityClass)
            );
        if (reachable.matchesNothing || scope === denyAll) {
            throw this.resolveOutOfScopeError();
        }
        // the scope alone rather than the identities joined to it, which say nothing more about a row
        // the store found by its identity - and which a store writing the batch as one statement would
        // have to bind a value of for every row, past what a statement binds
        return scope;
    }

    /**
     * Whether any branch of a scope has a condition on the given property.
     * @param scope - The scope the caller is restricted to.
     * @param key - The property.
     * @returns True when the scope reads it.
     */
    private scopeReads(scope: Where<T> | DenyAll | undefined, key: Extract<keyof T, string>): boolean {
        if (scope == undefined || scope === denyAll) {
            return false;
        }
        return ScopeWhereUtilities.branchesOf(scope).some(branch => key in branch);
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
        return await this.withinTimeout(options, 'createAll', async () => {
            // nothing to write is no round trip - a change set recording no change creates no changes
            if (!data.length) {
                return [];
            }
            // the rows and the rows created along with them are one write
            if (this.writeTransaction(options) == undefined && this.givesOwnedRows(data)) {
                return await this.inTransaction(options, async transaction => await this.createAll(data, { ...options, transaction }));
            }
            // one copy per entry, for the reason `create` takes one
            const own: CreateData[] = data.map(d => WriteDataUtilities.copy(d, this.entityClass));
            const owned: Record<string, unknown>[] = this.takeOwnedRows(own);
            const entitiesWithIdCount: number = (await Promise.all(
                own.map(async d => {
                    let hadId: boolean = false;
                    if (d.id != undefined && options?.allowId != true) {
                        delete d.id;
                        hadId = true;
                    }
                    this.assignId(d);
                    TenantUtilities.assignTenant(d, this.entityClass, this.entityMetadata, options?.acrossTenants);
                    this.writeUuidsInLowerCase(d);
                    await this.beforeSave(d, SaveOperation.CREATE);
                    await this.applyScopeToData(d, SaveOperation.CREATE, options);
                    return hadId;
                })
            )).filter(Boolean).length;
            if (entitiesWithIdCount) {
                this.logger.warn(
                    `Found an id on ${entitiesWithIdCount} out of ${data.length} entries of the create data. These ids will be ignored.`
                );
            }
            await this.validateReferences(
                own.map(d => ({ data: d, rowTenant: TenantUtilities.resolveTenantOf(d, this.entityClass) })),
                options
            );

            const res: T[] = await this.writeNewRows(own, options);
            // paired by position: the driver hands back the rows in the order they were given, and the
            // ids were assigned above, so the pairing is also by the id each row was written under
            const ownedRows: OwnedRowsById = await this.writeOwnedRows(
                own.map((d, i): [Record<string, unknown>, string, string | undefined] => [
                    owned[i] ?? {},
                    String(d.id),
                    TenantUtilities.resolveTenantOf(d, this.entityClass)
                ]),
                options,
                options?.allowId === true
            );
            return (await this.writtenEntities(res, options, ownedRows)).map(entity => this.withOwnedRows(entity, ownedRows));
        });
    }

    /**
     * Writes the rows a create makes.
     *
     * Inserted: every id was generated here, which no stored row holds, or given with `allowId` and
     * checked to be free first.
     * @param rows - The rows, each with its id.
     * @param options - The options of the create, holding its transaction and `allowId`.
     * @returns The written rows, in the order they were given.
     * @throws {UniqueConstraintViolationError} When a given id is held by a stored row.
     */
    private async writeNewRows(rows: DeepPartial<T>[], options: CreateOptions<T> | CreateAllOptions<T> | undefined): Promise<T[]> {
        const transaction: Transaction | undefined = this.writeTransaction(options);
        if (options?.allowId === true) {
            // a create is a create: a row given its id used to be *saved*, which rewrote a stored row
            // holding that id - another tenant's, another owner's, a soft deleted one - past every
            // check an update makes, since everything before this point judged the new data alone
            const ids: string[] = rows.map(row => String(row.id));
            const missing: Set<string> = await this.findMissingIds(this.entityClass, ids, transaction);
            if (ids.some(id => !missing.has(id))) {
                throw new UniqueConstraintViolationError(this.entityClass.name, ['id']);
            }
        }
        const res: T[] = await this.driver.insert(rows, transaction);
        this.recordWrittenRows(res, transaction);
        return res;
    }

    /**
     * Records the tenant of rows written inside a transaction, so that a write after it in the same
     * transaction pointing at them does not read them to learn it.
     * @param rows - The written rows, as they are stored.
     * @param transaction - The transaction they were written in, if any.
     */
    private recordWrittenRows(rows: T[], transaction: Transaction | undefined): void {
        WrittenRowTenantUtilities.record(
            transaction,
            this.entityClass,
            rows.map(row => [String(row.id), TenantUtilities.resolveTenantOf(row, this.entityClass)])
        );
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
     * @param ownedRows - The rows the write wrote along with each row, which answer their relations.
     * @returns The rows in the order they were written, each through the return hook.
     */
    private async writtenEntities(
        written: T[],
        options: BulkWriteOptions<T> | undefined,
        ownedRows: OwnedRowsById = new Map()
    ): Promise<T[]> {
        const relations: FindAllOptions<T>['relations'] = this.relationsToResolve(options);
        if (relations == undefined || !written.length || this.isAnsweredByOwnedRows(relations, written, ownedRows)) {
            await Promise.all(written.map(r => this.beforeReturn(r,true)));
            return written;
        }

        const read: T[] = await this.driver.find({
            where: { id: { oneOf: written.map(w => w.id) } } as Where<T>,
            relations,
            related: await this.resolveRelated(undefined, relations, options),
            transaction: options?.transaction
        });
        await Promise.all(read.map(r => this.beforeReturn(r,true)));

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
            && UUIDUtilities.declaresUuidFormat(MetadataUtilities.getModelProperties(this.entityClass)['id'])
            && !UUIDUtilities.isUuid(data.id)
        ) {
            throw new InternalError(
                `"${this.entityClass.name}.id" declares the uuid format, so "${data.id}" cannot be stored as one. `
                + 'A chosen id has to be a uuid too. A key that is no uuid belongs in a property of its own, declared unique.'
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
    async findById<B extends boolean = true, const S extends EntitySelection<T> | undefined = undefined>(
        id: T['id'],
        options?: FindByIdOptions<T, B, S>
    ): Promise<B extends false ? Projected<T, S> | undefined : Projected<T, S>> {
        return await this.withinTimeout(options, 'findById', async () => {
            // combined with whatever the caller asked for rather than replacing it. Spreading the
            // options over the id let a `where` they carried take the id's place, so the read looked
            // for any row matching that filter instead of for this one
            const byId: ScopedWhere<T> = ScopeWhereUtilities.applyToWhere(
                options?.where,
                [{ id } as WhereFilter<T>],
                MetadataUtilities.getModelProperties(this.entityClass)
            );
            const res: Projected<T, S> | undefined = byId.matchesNothing
                ? undefined
                : await this.findOne<false, S>({ ...options, where: byId.where, required: false });
            if (!res && options?.required !== false) {
                throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
            }
            return res as B extends false ? Projected<T, S> | undefined : Projected<T, S>;
        });
    }

    /**
     * Finds a single entity with the given options.
     * @param options - The options, including the where filter, whether a result is required etc.
     * @returns The found result. If required is set to false, also undefined.
     */
    async findOne<B extends boolean = true, const S extends EntitySelection<T> | undefined = undefined>(
        options: FindOneOptions<T, B, S>
    ): Promise<B extends false ? Projected<T, S> | undefined : Projected<T, S>> {
        return await this.withinTimeout(options, 'findOne', async () => {
            const scoped: ScopedWhere<T> = await this.scopedWhere(options.where, options);
            // a row the scope excludes is answered exactly like one that does not exist, so a caller
            // cannot use a guarded route to find out which ids are real
            const res: T | undefined = scoped.matchesNothing
                ? undefined
                : await this.driver.findOne(await this.toDriverFindOptions(options, scoped.where));

            if (!res && options.required !== false) {
                throw new NotFoundError($ts`Could not find ${this.entityClass.name}.`);
            }
            if (!res) {
                return undefined as B extends false ? Projected<T, S> | undefined : Projected<T, S>;
            }
            await this.beforeReturn(res,options.autoDecrypt ?? true);
            return this.narrowToSelection([res], options.select)[0] as B extends false ? Projected<T, S> | undefined : Projected<T, S>;
        });
    }

    /**
     * Narrows rows that went through the return hooks to what a read selected.
     *
     * After the hooks rather than before them, so that what they decide - an excluded property, a
     * decrypted one - is decided on the row as it was read.
     * @param rows - The rows, as the hooks left them.
     * @param select - What the read selected, if anything.
     * @returns The rows, narrowed. The same rows when nothing was selected.
     */
    private narrowToSelection(rows: T[], select: EntitySelection<T> | undefined): T[] {
        const tree: SelectionTree | undefined = EntitySelectionUtilities.resolveTree(select);
        if (tree == undefined) {
            return rows;
        }
        return rows.map(row => EntitySelectionUtilities.project(row, tree, this.entityClass));
    }

    /**
     * Finds all entities with the given options.
     * @param options - The options, including the where filter etc.
     * @returns An array of found entities, narrowed to what `select` names when it names anything.
     */
    async findAll<const S extends EntitySelection<T> | undefined = undefined>(options?: FindAllOptions<T, S>): Promise<Projected<T, S>[]> {
        return await this.withinTimeout(options, 'findAll', async () => {
            const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
            if (scoped.matchesNothing) {
                return [];
            }

            const driverOptions: DriverFindOptions<T> = await this.toDriverFindOptions(options, scoped.where);
            // a call that names no limit is claiming the result is small enough to hold, and this
            // checks that claim rather than believing it. One row more than the cap is asked for, so
            // getting that row back is proof there was something past the cap - a result of exactly
            // the cap is a table that fits, not one that was cut short.
            //
            // Read from what the caller passed rather than from the driver options, because `'all'`
            // reaches the store as no limit too and is the one case that is deliberate
            const probe: number = UNBOUNDED_FIND_ALL_LIMIT + 1;
            const unbounded: boolean = options?.limit == undefined;
            if (unbounded) {
                driverOptions.limit = probe;
            }

            const res: T[] = await this.driver.find(driverOptions);
            if (unbounded && res.length === probe) {
                // refused rather than trimmed. Handing back the first thousand rows of a larger table
                // would make every caller that loops over the result quietly do part of its work -
                // half the mails sent, half the rows migrated - and nothing would say so. A table that
                // has outgrown what a call assumed is worth hearing about at the call that assumed it
                throw new InternalError(
                    `${this.entityClass.name}.findAll() matched more than ${UNBOUNDED_FIND_ALL_LIMIT} rows without a limit.`
                    + ' Pass a `limit`, use findAllPaginated, or pass `limit: \'all\'` if reading every row is meant.'
                );
            }

            await Promise.all(res.map(r => this.beforeReturn(r,options?.autoDecrypt ?? true)));
            // narrowed at run time to what the selection names, which is what the type says
            return this.narrowToSelection(res, options?.select) as Projected<T, S>[];
        });
    }

    /**
     * Reads every entity matching the given options, without holding them all at once.
     *
     * The way past the bound `findAll` puts on a read that names no limit. `findAll` refuses above
     * 10,000 rows because a result that outgrew the heap is worth hearing about
     * at the call that assumed it would not; this is how a caller says it is not holding the result
     * at all, so there is nothing left to outgrow.
     *
     * Narrowed by the same scopes every other read is, and each entity goes through the same
     * `beforeReturn` - decryption included - so a streamed row is the row `findAll` would have
     * handed back.
     *
     * Stopping early stops the reading: `break` out of the loop and nothing further is fetched.
     * @param options - The where filter, the order and the relations to resolve. There is no limit -
     * see {@link StreamOptions}.
     * @yields Each matching entity, in turn.
     * @example
     * for await (const invoice of invoiceRepository.stream({ where: { paid: false } })) {
     *     await this.remind(invoice);
     * }
     */
    async* stream<const S extends EntitySelection<T> | undefined = undefined>(
        options?: StreamOptions<T, S>
    ): AsyncIterable<Projected<T, S>> {
        if (options?.timeoutInMs == undefined) {
            for await (const entity of this.streamRows(options)) {
                // narrowed at run time to what the selection names, which is what the type says
                yield entity as Projected<T, S>;
            }
            return;
        }

        // pulled in pieces, so the limit cannot wrap one call the way `withinTimeout` does: it is
        // started once and every pull runs under it, the time the caller spends between two rows
        // included - a stream that is held open is work that is still running
        const opened: OpenedOperationLimit = OperationLimitUtilities.openLimit(options.timeoutInMs, `${this.entityClass.name}.stream`);
        const rows: AsyncIterator<T> = this.streamRows(options)[Symbol.asyncIterator]();
        try {
            while (true) {
                const next: IteratorResult<T> = await AlsUtilities.runWithOperationLimit(opened.limit, async () => await rows.next());
                if (next.done === true) {
                    return;
                }
                yield next.value as Projected<T, S>;
            }
        }
        finally {
            opened.close();
            await rows.return?.();
        }
    }

    /**
     * Reads every entity matching the given options, one at a time, as {@link stream} hands them out.
     * @param options - The where filter, the relations to resolve and what to select.
     * @yields Each matching entity, in turn, narrowed to what was selected.
     */
    private async* streamRows(options: StreamOptions<T, EntitySelection<T> | undefined> | undefined): AsyncIterable<T> {
        const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
        if (scoped.matchesNothing) {
            return;
        }

        for await (const entity of this.driver.stream(await this.toDriverStreamOptions(options, scoped.where))) {
            await this.beforeReturn(entity,options?.autoDecrypt ?? true);
            yield* this.narrowToSelection([entity], options?.select);
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
    async findAllPaginated<const S extends EntitySelection<T> | undefined = undefined>(
        page: number,
        limit: number,
        options?: FindAllPaginatedOptions<T, S>
    ): Promise<PaginationResult<Projected<T, S>>> {
        return await this.withinTimeout(options, 'findAllPaginated', async () => {
            // named by what the caller passed, before they turn into an offset and a limit
            this.validateCount('page', page, 1);
            this.validateCount('limit', limit, 1);
            // narrowed once and used for both halves. The count used to be taken from the caller's
            // filter alone, which on a scoped entity reported how many rows exist rather than how
            // many the caller may see - a leak the page of items itself does not have
            const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
            if (scoped.matchesNothing) {
                return { items: [], totalAmount: 0 };
            }

            // one call rather than a read and then a count. The two are answers to the same
            // question, and asking it twice lets anything written in between separate them: a total
            // that counts rows the page does not hold, or holds rows the total does not count. What a
            // caller shows someone is the pair - "20 of 137" - so it is the pair that has to be true.
            // Which is also why the page is not read through `findAll`: its bound is for a call that
            // named no limit, and this one always names one.
            const res: PaginationResult<T> = await this.driver.findAndCount(await this.toDriverFindOptions(
                { ...options, offset: (page - 1) * limit, limit },
                scoped.where
            ));

            await Promise.all(res.items.map(i => this.beforeReturn(i,options?.autoDecrypt ?? true)));
            // narrowed at run time to what the selection names, which is what the type says
            return { ...res, items: this.narrowToSelection(res.items, options?.select) as Projected<T, S>[] };
        });
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
    async findAllAfter<const S extends EntitySelection<T> | undefined = undefined>(
        cursor: string | undefined,
        limit: number,
        options?: FindAllPaginatedOptions<T, S>
    ): Promise<KeysetPage<Projected<T, S>>> {
        return await this.withinTimeout(options, 'findAllAfter', async () => {
            this.validateCount('limit', limit, 1);
            const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
            if (scoped.matchesNothing) {
                return { items: [], totalAmount: 0, nextCursor: undefined };
            }

            // resolved before the cursor is read, because the cursor is only valid for this order and
            // this filter - and because an order that cannot be continued through is the caller's
            // mistake whether or not they passed a cursor
            const driverOptions: DriverFindOptions<T> = await this.toDriverFindOptions({ ...options, limit }, scoped.where);
            const keys: KeysetOrderKey[] = resolveKeysetOrder(this.entityClass, driverOptions.order);
            const fingerprint: string = keysetFingerprint(keys, scoped.where);
            if (driverOptions.select != undefined) {
                // the next cursor is read off the last row, so what it is ordered by is read whether
                // or not it is selected - and left off the rows again before they are handed back
                driverOptions.select = EntitySelectionUtilities.withKeys(driverOptions.select, keys.map(key => key.property));
            }

            const after: ScopedWhere<T> = cursor == undefined
                ? scoped
                : afterCursorWhere(
                    scoped.where,
                    keysetStepsFor(decodeKeysetCursor(cursor, fingerprint), keys),
                    MetadataUtilities.getModelProperties(this.entityClass)
                );
            if (after.matchesNothing) {
                // the position and the caller's filter contradict each other, so nothing is past the
                // cursor - and the total is still what the filter matches, as on every other page
                return {
                    items: [],
                    totalAmount: await this.driver.count({ ...driverOptions, where: scoped.where }),
                    nextCursor: undefined
                };
            }

            const res: PaginationResult<T> = await this.driver.findAndCount({
                ...driverOptions,
                where: after.where,
                // the window is the rows after the cursor and the total is the rows that match at
                // all, so that a walk reports "137 of them" throughout rather than counting down. An
                // empty filter rather than none when the caller gave none: leaving it out says "the
                // same question as the window", which here is the one thing it is not
                totalWhere: cursor == undefined ? undefined : scoped.where ?? {}
            });

            await Promise.all(res.items.map(i => this.beforeReturn(i,options?.autoDecrypt ?? true)));

            // a short page is the end of the walk. A page that filled up may also be, and the caller
            // hears that from the next call handing back nothing - which is one read more than
            // counting would cost and does not need the total to be exact at the moment the walk ends
            const last: T | undefined = res.items.length < limit ? undefined : res.items.at(-1);
            return {
                totalAmount: res.totalAmount,
                // narrowed at run time to what the selection names, which is what the type says
                items: this.narrowToSelection(res.items, options?.select) as Projected<T, S>[],
                nextCursor: last == undefined
                    ? undefined
                    : encodeKeysetCursor({ order: fingerprint, values: keysetValuesOf(last, keys) })
            };
        });
    }

    /**
     * Counts the entities matching the given filter, without reading any of them.
     *
     * Unlike `findAll` this has no upper bound, so how many there are stays answerable once there are
     * more of them than fit in memory.
     * @param options - The options, including the where filter and a transaction.
     * @returns How many entities match, of those the caller is allowed to see.
     */
    async count<const G extends readonly GroupKeysOf<T>[] | undefined = undefined>(
        options?: CountOptions<T, G>
    ): Promise<Aggregated<T, G, 'count', number>> {
        return await this.withinTimeout(options, 'count', async () => {
            if (options?.groupBy != undefined) {
                // one row per group, which is the shape the type gives a grouped count
                return await this.resolveAggregate('count', undefined, options) as Aggregated<T, G, 'count', number>;
            }
            const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
            if (scoped.matchesNothing) {
                return 0 as Aggregated<T, G, 'count', number>;
            }
            return await this.driver.count({
                where: scoped.where,
                related: await this.resolveRelated(scoped.where, undefined, options),
                transaction: options?.transaction
            }) as Aggregated<T, G, 'count', number>;
        });
    }

    /**
     * Adds up a number property over the entities a filter matches, without reading any of them.
     *
     * An entity holding no value for it is left out, and no entity at all adds up to 0. Narrowed by
     * the scopes every read is, so the sum is of the entities the caller may see.
     * @param property - The number property to add up.
     * @param options - The where filter, a transaction, and the properties to add up per group of.
     * @returns The sum, or one row per group holding what the group shares and `sum`.
     */
    async sum<const G extends readonly GroupKeysOf<T>[] | undefined = undefined>(
        property: NumberKeysOf<T>,
        options?: AggregateOptions<T, G>
    ): Promise<Aggregated<T, G, 'sum', number>> {
        return await this.withinTimeout(options, 'sum', async () => {
            // the shape the type gives it: a number, or one row per group
            return await this.resolveAggregate('sum', String(property), options) as Aggregated<T, G, 'sum', number>;
        });
    }

    /**
     * Averages a number property over the entities a filter matches, without reading any of them.
     *
     * An entity holding no value for it is left out, and with no value at all there is no average.
     * @param property - The number property to average.
     * @param options - The where filter, a transaction, and the properties to average per group of.
     * @returns The average, or one row per group holding what the group shares and `average`.
     */
    async average<const G extends readonly GroupKeysOf<T>[] | undefined = undefined>(
        property: NumberKeysOf<T>,
        options?: AggregateOptions<T, G>
    ): Promise<Aggregated<T, G, 'average', number | undefined>> {
        return await this.withinTimeout(options, 'average', async () => {
            // the shape the type gives it: a number, or one row per group
            return await this.resolveAggregate('average', String(property), options) as Aggregated<T, G, 'average', number | undefined>;
        });
    }

    /**
     * Finds the smallest value of a number or date property among the entities a filter matches,
     * without reading any of them.
     * @param property - The number or date property.
     * @param options - The where filter, a transaction, and the properties to find it per group of.
     * @returns The smallest value, or one row per group holding what the group shares and `minimum`.
     */
    async minimum<K extends OrderedKeysOf<T>, const G extends readonly GroupKeysOf<T>[] | undefined = undefined>(
        property: K,
        options?: AggregateOptions<T, G>
    ): Promise<Aggregated<T, G, 'minimum', NonNullable<T[K]> | undefined>> {
        return await this.withinTimeout(options, 'minimum', async () => {
            // the shape the type gives it: a value of the property, or one row per group
            const res: unknown = await this.resolveAggregate('minimum', String(property), options);
            return res as Aggregated<T, G, 'minimum', NonNullable<T[K]> | undefined>;
        });
    }

    /**
     * Finds the largest value of a number or date property among the entities a filter matches,
     * without reading any of them.
     * @param property - The number or date property.
     * @param options - The where filter, a transaction, and the properties to find it per group of.
     * @returns The largest value, or one row per group holding what the group shares and `maximum`.
     */
    async maximum<K extends OrderedKeysOf<T>, const G extends readonly GroupKeysOf<T>[] | undefined = undefined>(
        property: K,
        options?: AggregateOptions<T, G>
    ): Promise<Aggregated<T, G, 'maximum', NonNullable<T[K]> | undefined>> {
        return await this.withinTimeout(options, 'maximum', async () => {
            // the shape the type gives it: a value of the property, or one row per group
            const res: unknown = await this.resolveAggregate('maximum', String(property), options);
            return res as Aggregated<T, G, 'maximum', NonNullable<T[K]> | undefined>;
        });
    }

    /**
     * Takes a value over the entities a filter matches, narrowed by the scopes every read is.
     * @param fn - What is taken.
     * @param property - The property it is taken of. Undefined for a count.
     * @param options - The where filter, a transaction, and the properties to take it per group of.
     * @returns The value, 0 for a sum or count of nothing, or one row per group when grouped.
     */
    private async resolveAggregate(
        fn: AggregateFunction,
        property: string | undefined,
        options: AggregateCallOptions<T> | undefined
    ): Promise<unknown> {
        if (property != undefined) {
            AggregateUtilities.validateAggregatedProperty(fn, property, this.entityClass);
        }
        const groupBy: string[] = (options?.groupBy ?? []).map(String);
        AggregateUtilities.validateGroupKeys(groupBy, this.entityClass);

        const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
        const rows: AggregateRow[] = scoped.matchesNothing
            ? []
            : await this.driver.aggregate({
                where: scoped.where,
                related: await this.resolveRelated(scoped.where, undefined, options),
                transaction: options?.transaction,
                fn,
                property,
                groupBy
            });
        // a sum or count of nothing is 0, as it is everywhere else; the others have nothing to answer
        const valueOf: (row: AggregateRow | undefined) => unknown = row => {
            const value: unknown = AggregateUtilities.resolveValue(fn, property, row?.value, this.entityClass);
            return fn === 'sum' || fn === 'count' ? value ?? 0 : value;
        };
        if (options?.groupBy == undefined) {
            return valueOf(rows[0]);
        }
        return rows.map(row => ({ ...AggregateUtilities.resolveGroup(row.group, this.entityClass), [fn]: valueOf(row) }));
    }

    /**
     * Whether any entity matches the given filter.
     *
     * No entity is returned, so nothing is decrypted and no relation is resolved.
     * @param options - The options, including the where filter and a transaction.
     * @returns Whether an entity the caller is allowed to see matches.
     */
    async exists(options?: CountOptions<T>): Promise<boolean> {
        return await this.withinTimeout(options, 'exists', async () => {
            const scoped: ScopedWhere<T> = await this.scopedWhere(options?.where, options);
            if (scoped.matchesNothing) {
                return false;
            }
            // one row rather than a count, because a filter matching a million rows has to read a
            // million of them to report how many there are and the first one already answers this.
            // `find` with a limit rather than `findOne`: this is asked with no filter at all - is
            // there anything yet - and a driver may refuse to look for a single row without one
            const res: T[] = await this.driver.find({
                where: scoped.where,
                // explicit, so the entity's default relations are not joined for a row nobody reads
                relations: [],
                related: await this.resolveRelated(scoped.where, undefined, options),
                limit: 1,
                transaction: options?.transaction
            });
            return res.length > 0;
        });
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
        return await this.withinTimeout(options, 'updateById', async () => {
            if (!await this.exists({ ...options, where: { id } as Where<T> })) {
                throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
            }
            return (await this.saveUpdate(id, data, options)).entity;
        });
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
        // the row and the rows written along with it are one write
        if (this.writeTransaction(options) == undefined && this.givesOwnedRows([data])) {
            return await this.inTransaction(options, async transaction => await this.saveUpdate(id, data, { ...options, transaction }));
        }
        if (data.id != undefined) {
            this.logger.warn('Found an id on the update data, it will be ignored.');
        }

        // before anything is written or any hook runs: what this refuses is a call that was written
        // wrong, and the answer to it is a different call rather than a retry
        validateWriteIsNotBlind(this.entityClass, data, options?.where);

        // a copy, for the same reason `create` takes one: the id below and whatever `beforeSave`
        // writes are changes to the caller's object otherwise
        const own: UpdateData = { ...WriteDataUtilities.copy(data, this.entityClass), id };
        const [owned] = this.takeOwnedRows([own]);
        this.writeUuidsInLowerCase(own);
        await this.beforeSave(own, SaveOperation.UPDATE);
        await this.applyScopeToData(own, SaveOperation.UPDATE, options);
        if (TenantUtilities.pointsAtRows(own, this.entityClass)) {
            const rowTenant: string | undefined = await this.resolveTenantOfUpdated(
                options,
                async () => await this.findById(id, { ...options, where: undefined, relations: [] })
            );
            await this.validateReferences([{ data: own, rowTenant }], options);
        }

        // the condition is dropped for the read *after* the write, because the write is usually what
        // stops it holding - a compare and set that flips the very column it tested would otherwise
        // report the row it just changed as gone
        const findOptions: FindByIdOptions<T> = { ...options, where: undefined };
        const reach: ScopedWhere<T> = this.resolveWriteWhere(options?.where, options);
        const scoped: ScopedWhere<T> = reach.matchesNothing ? reach : await this.scopedWhere(reach.where, options);
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
            related: await this.resolveRelated(withId.where, undefined, options),
            returnUpdated: true
        });
        await this.validateUpdateWasWritten(updated.length, id, findOptions);
        this.recordWrittenRows(updated, this.writeTransaction(options));
        // with the id, which is what tells the rows this row held apart from the ones it is given
        const rowTenant: string | undefined = TenantUtilities.resolveTenantOf(updated[0] ?? {}, this.entityClass);
        await this.writeOwnedRows([[{ ...owned, id }, String(id), rowTenant]], options, false);

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
        await this.beforeReturn(entity,findOptions.autoDecrypt ?? true);
        return entity;
    }

    /**
     * Updates several rows, each with values of its own: what {@link updateById} does to each of
     * them, with one write for all of them. A row the caller may not see is not found, and refuses
     * the whole call.
     *
     * How a save writes the rows it gives a relation with their ids. The rows are not read first:
     * the write is narrowed to what the caller may change, and a row it did not land on is told
     * apart afterwards, as an update of one row tells it apart.
     * @param rows - The values of each row, with its id.
     * @param options - The options of the write, holding its transaction.
     * @param where - What every row has to match besides what the caller may change, as a subclass
     * narrows what its rows are.
     * @returns Each row as it is now and the change written to it, in the order they were given.
     * @throws When a row is not there for the caller to change.
     */
    protected async updateEach(rows: UpdateData[], options?: BaseRepositoryOptions, where?: Where<T>): Promise<WrittenUpdate<T>[]> {
        return await this.applyUpdateEach(rows, options, where, true);
    }

    /**
     * Updates several rows, each with values of its own, as {@link updateEach} does - leaving out a
     * row that is not there, or no longer matches, rather than refusing the call for it. Writes no
     * change set, for the reason {@link saveUpdateAll} writes none.
     * @param rows - The values of each row, with its id.
     * @param options - The options of the write, holding its transaction.
     * @param where - What every row has to match besides what the caller may change.
     * @returns Each row it wrote as it is now and the change written to it.
     */
    protected async saveUpdateEach(rows: UpdateData[], options?: BaseRepositoryOptions, where?: Where<T>): Promise<WrittenUpdate<T>[]> {
        return await this.applyUpdateEach(rows, options, where, false);
    }

    /**
     * The one implementation behind {@link updateEach} and {@link saveUpdateEach}.
     * @param rows - The values of each row, with its id.
     * @param options - The options of the write, holding its transaction.
     * @param where - What every row has to match besides what the caller may change.
     * @param refusesMissing - Whether a row the write did not land on refuses the call.
     * @returns Each row it wrote as it is now and the change written to it, in the order they were
     * given.
     * @throws When a row is not there for the caller to change, and that refuses the call.
     */
    private async applyUpdateEach(
        rows: UpdateData[],
        options: BaseRepositoryOptions | undefined,
        where: Where<T> | undefined,
        refusesMissing: boolean
    ): Promise<WrittenUpdate<T>[]> {
        if (!rows.length) {
            return [];
        }
        // the rows and the rows written along with them are one write
        if (this.writeTransaction(options) == undefined && this.givesOwnedRows(rows)) {
            return await this.inTransaction(
                options,
                async transaction => await this.applyUpdateEach(rows, { ...options, transaction }, where, refusesMissing)
            );
        }
        const ids: T['id'][] = rows.map(row => {
            if (row.id == undefined) {
                throw new InternalError(`Updating several "${this.entityClass.name}" rows needs the id of each.`);
            }
            validateWriteIsNotBlind(this.entityClass, row, undefined);
            return row.id;
        });

        // a copy each, for the reason saveUpdate takes one
        const own: UpdateData[] = rows.map(row => WriteDataUtilities.copy(row, this.entityClass));
        const owned: Record<string, unknown>[] = this.takeOwnedRows(own);
        await Promise.all(own.map(async data => {
            this.writeUuidsInLowerCase(data);
            await this.beforeSave(data, SaveOperation.UPDATE);
            await this.applyScopeToData(data, SaveOperation.UPDATE, options);
        }));
        if (own.some(data => TenantUtilities.pointsAtRows(data, this.entityClass))) {
            await this.validateReferences(await this.resolveTenantsOfUpdated(own, options), options);
        }

        const reach: ScopedWhere<T> = this.resolveWriteWhere(where, options);
        const scoped: ScopedWhere<T> = reach.matchesNothing ? reach : await this.scopedWhere(reach.where, options);
        // composed rather than spread, for the reason saveUpdate composes its id
        const withIds: ScopedWhere<T> = scoped.matchesNothing
            ? scoped
            : ScopeWhereUtilities.applyToWhere(
                scoped.where,
                [{ id: { oneOf: ids } } as WhereFilter<T>],
                MetadataUtilities.getModelProperties(this.entityClass)
            );
        const written: T[] = withIds.matchesNothing
            ? []
            : await this.driver.updateEach(
                own,
                withIds.where ?? ({ id: { oneOf: ids } } as Where<T>),
                this.writeTransaction(options),
                await this.resolveRelated(withIds.where, undefined, options)
            );

        const writtenById: Map<string, T> = new Map(written.map(row => [String(row.id), row]));
        const missing: T['id'] | undefined = ids.find(id => !writtenById.has(String(id)));
        if (refusesMissing && missing != undefined) {
            await this.validateUpdateWasWritten(0, missing, { ...options, where: undefined });
        }
        // in the order they were given, which is the order the caller pairs them up in
        const updated: T[] = ids.map(id => writtenById.get(String(id))).filter((row): row is T => row != undefined);
        this.recordWrittenRows(updated, this.writeTransaction(options));
        // by id rather than by position, since a row left out shifts every one after it
        const ownedById: Map<string, Record<string, unknown> | undefined> = new Map(ids.map((id, i) => [String(id), owned[i]]));
        await this.writeOwnedRows(
            updated.map((row): [Record<string, unknown>, string, string | undefined] => [
                { ...ownedById.get(String(row.id)), id: row.id },
                String(row.id),
                TenantUtilities.resolveTenantOf(row, this.entityClass)
            ]),
            options,
            false
        );

        const ownById: Map<string, UpdateData> = new Map(own.map(data => [String(data.id), data]));
        return (await this.writtenEntities(updated, options)).map(entity => {
            const data: UpdateData | undefined = ownById.get(String(entity.id));
            if (data == undefined) {
                throw new InternalError(`Updating "${this.entityClass.name}" wrote a row with id "${String(entity.id)}" it was not given.`);
            }
            return { entity, written: data };
        });
    }

    /**
     * Resolves the tenant of each row an update of several rows changes, for checking what it points
     * them at: the active one where every row belongs to it, read for all of them at once otherwise.
     * @param rows - The data of each row, with its id.
     * @param options - The options of the update.
     * @returns The data of each row with the tenant the row belongs to.
     */
    private async resolveTenantsOfUpdated(rows: UpdateData[], options: BaseRepositoryOptions | undefined): Promise<TenantRowData[]> {
        // read once for every row that needs it, and only when one does
        let stored: Promise<Map<string, T>> | undefined;
        const readStored: () => Promise<Map<string, T>> = async () => {
            stored ??= (async () => {
                const found: T[] = await this.findAll({
                    ...options,
                    where: { id: { oneOf: rows.map(r => r.id) } } as Where<T>,
                    limit: 'all',
                    relations: [],
                    autoDecrypt: false
                });
                return new Map(found.map(row => [String(row.id), row]));
            })();
            return await stored;
        };
        return await Promise.all(rows.map(async data => ({
            data,
            rowTenant: await this.resolveTenantOfUpdated(options, async () => {
                const row: T | undefined = (await readStored()).get(String(data.id));
                if (row == undefined) {
                    throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${String(data.id)}".`);
                }
                return row;
            })
        })));
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
     * @throws A conflict when the row is there, a not found when it is not, and a forbidden when it is
     * there and not the caller's to change. Nothing when the update landed.
     */
    protected async validateUpdateWasWritten(updated: number, id: T['id'], findOptions: FindByIdOptions<T>): Promise<void> {
        if (updated) {
            return;
        }
        const visible: T | undefined = await this.findById(id, { ...findOptions, required: false });
        if (visible) {
            this.validateWritable(visible, findOptions);
            throw new ConflictError(
                $ts`The ${this.entityClass.name} with id "${id}" changed since it was read, so the update was not applied.`
            );
        }
        throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
    }

    /**
     * Updates all entities that match the provided where filter.
     *
     * A number property can be given `{ increment: amount }` instead of a value, which adds the amount
     * to what each row stores in the same write, so that two callers adding at the same time both
     * land. A property holding no value counts as 0. An increment of a property the caller's scope
     * reads is judged on what it wrote, and the update is refused and undone when a row left what
     * the caller may see.
     * @param where - The where filter to find the entities that should be updated.
     * @param data - The data to update the entities with.
     * @param options - Additional options, like a transaction.
     * @returns How many entities were updated, or the entities themselves when `returnUpdated` asked
     * for them.
     */
    async updateAll<R extends boolean = false>(
        where: Where<T>,
        data: UpdateAllData<T, UpdateData>,
        options?: UpdateAllOptions<T, R>
    ): Promise<R extends true ? T[] : number> {
        return await this.withinTimeout(options, 'updateAll', async () => {
            const [values, increments] = UpdateIncrementUtilities.resolveValuesAndIncrements<UpdateData>(data, this.entityClass);
            const res: BulkUpdate<T> = await this.applyUpdateAll(where, values, increments, options, options?.returnUpdated ?? false);
            return (options?.returnUpdated === true ? res.updates.map(u => u.entity) : res.count) as R extends true ? T[] : number;
        });
    }

    /**
     * The write half of {@link updateAll}, for callers that need what was written to each row.
     *
     * Split out for the same reason {@link saveUpdate} hands its change back: a change set records
     * what landed, and what landed is the caller's change plus whatever the save hooks put on it.
     * One entry per row, because a bound encrypted value is encrypted for the row it lands in, and an
     * amount added lands as a value of each row's own.
     * @param where - The where filter to find the entities that should be updated.
     * @param data - The data to update the entities with.
     * @param options - Additional options, like a transaction.
     * @returns Each updated row with the change that produced it.
     */
    protected async saveUpdateAll(
        where: Where<T>,
        data: UpdateAllData<T, UpdateData>,
        options?: UpdateAllOptions<T, boolean>
    ): Promise<WrittenUpdate<T>[]> {
        const [values, increments] = UpdateIncrementUtilities.resolveValuesAndIncrements<UpdateData>(data, this.entityClass);
        return (await this.applyUpdateAll(where, values, increments, options, true)).updates;
    }

    /**
     * The one implementation behind {@link updateAll} and {@link saveUpdateAll}.
     *
     * Which entities to write is decided the same way whether or not they are wanted back, and only
     * what happens after the write differs. Reading them back is the caller's decision, because a
     * bulk update is where nothing bounds what that costs - the write half of what the 10,000 row
     * bound of `findAll` exists for on the read side.
     * @param where - The where filter to find the entities that should be updated.
     * @param data - The values to update the entities with.
     * @param increments - The amounts to add to what the entities store, by property.
     * @param options - Additional options, like a transaction.
     * @param returnUpdated - Whether the updated entities have to be read back. Separate from the
     * caller's own `returnUpdated`, because a change set needs them whether or not anyone asked -
     * and only the caller's ask is what the bound on handing them out is about.
     * @returns How many were updated, and each of them with its change when they were read back.
     */
    private async applyUpdateAll(
        where: Where<T>,
        data: UpdateData,
        increments: IncrementAmounts,
        options: UpdateAllOptions<T, boolean> | undefined,
        returnUpdated: boolean
    ): Promise<BulkUpdate<T>> {
        // only what it sets: an amount adds to whatever is stored, so a write that landed in between
        // is kept rather than lost, as on the conflict path of an upsert
        validateWriteIsNotBlind(this.entityClass, data, where);
        if (this.givesOwnedRows([data])) {
            return await this.applyUpdateAllWithOwnedRows(where, data, increments, options);
        }

        // a copy, for the reason `create` takes one
        const own: UpdateData = WriteDataUtilities.copy(data, this.entityClass);
        if (own.id != undefined) {
            this.logger.warn('Found an id on the update data, it will be ignored.');
            delete own.id;
        }
        this.writeUuidsInLowerCase(own);

        const reach: ScopedWhere<T> = this.resolveWriteWhere(where, options);
        const scoped: ScopedWhere<T> = reach.matchesNothing ? reach : await this.scopedWhere(reach.where, options);
        if (scoped.matchesNothing) {
            return { count: 0, updates: [] };
        }

        // an amount a row adds is not known until it lands, since what it adds to is whatever is
        // stored - so where the scope reads the property, the rows are judged on what was written, in
        // a transaction that undoes the update when one of them left the caller's reach
        const scope: Where<T> | DenyAll | undefined = await this.resolveRestriction(options);
        const judgedAfter: string[] = Object.keys(increments).filter(key => this.scopeReads(scope, key as Extract<keyof T, string>));

        const boundProperties: string[] = await boundEncryptionProperties(own, this.entityClass);
        if (boundProperties.length) {
            // that branch writes a value of its own to every row, so it has them either way
            const updates: WrittenUpdate<T>[] = await this.updateAllBound(
                scoped.where ?? where,
                own,
                increments,
                boundProperties,
                { scope, judgedAfter },
                options
            );
            return { count: updates.length, updates };
        }

        await this.beforeSave(own, SaveOperation.UPDATE);
        await this.applyScopeToData(own, SaveOperation.UPDATE, options);
        if (TenantUtilities.pointsAtRows(own, this.entityClass)) {
            await this.validateReferences([{ data: own, rowTenant: await this.resolveTenantOfUpdated(options) }], options);
        }

        const related: RelatedNarrowing | undefined = await this.resolveRelated(scoped.where ?? where, undefined, options);
        if (!returnUpdated && !judgedAfter.length) {
            // one driver call and nothing around it, so no transaction is taken here: a driver that
            // has to hold its rows takes one of its own, and one that writes in a single statement
            // would have paid a BEGIN and a COMMIT for nothing
            const count: number = await this.driver.updateAll({
                where: scoped.where ?? where,
                data: own,
                increments,
                transaction: this.writeTransaction(options),
                related
            });
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
                increments,
                transaction,
                related,
                returnUpdated: true
            });
            for (const entity of written) {
                this.validateWithinScope(entity, judgedAfter, scope);
            }
            if (!returnUpdated) {
                return written;
            }
            // inside the transaction the write ran in, because rows that are not committed yet are
            // not rows anything outside it can read
            return await this.writtenEntities(written, { ...options, transaction });
        });
        // one change for every row here, the values being the same for all of them and the amounts
        // landing as what each row holds now. A copy each, because whoever records it may write to it.
        return {
            count: res.length,
            updates: returnUpdated ? res.map(entity => ({ entity, written: this.resolveWritten(own, increments, entity) })) : []
        };
    }

    /**
     * What an update wrote to one row: the values it set, and for every amount it added the value the
     * row holds now.
     * @param values - The values the update set, as they were stored.
     * @param increments - The amounts it added, by property.
     * @param entity - The row as it is after the update.
     * @returns The change, a copy of its own.
     */
    private resolveWritten(values: UpdateData, increments: IncrementAmounts, entity: T): DeepPartial<T> {
        const res: Record<string, unknown> = { ...values };
        for (const key of Object.keys(increments)) {
            res[key] = Reflect.get(entity, key);
        }
        return res as DeepPartial<T>;
    }

    /**
     * The half of {@link applyUpdateAll} for data that gives a value for a one to many or has one
     * relation: the rows are updated as any others, then every one of them gets the value, the way
     * {@link updateById} gives it to its row.
     *
     * Every row gets its own copy of the rows given without an id. A row given with one belongs to one
     * row only, so it is refused once the filter matches more.
     * @param where - The where filter to find the entities that should be updated.
     * @param data - The values to update the entities with.
     * @param increments - The amounts to add to what the entities store, by property.
     * @param options - Additional options, like a transaction.
     * @returns How many were updated, and each of them with its change.
     * @throws When a row given with an id would go to more rows than one.
     */
    private async applyUpdateAllWithOwnedRows(
        where: Where<T>,
        data: UpdateData,
        increments: IncrementAmounts,
        options: UpdateAllOptions<T, boolean> | undefined
    ): Promise<BulkUpdate<T>> {
        return await this.inTransaction(options, async transaction => {
            const own: UpdateData = WriteDataUtilities.copy(data, this.entityClass);
            const [owned] = this.takeOwnedRows([own]);
            const inTransaction: UpdateAllOptions<T, boolean> = { ...options, transaction };
            const res: BulkUpdate<T> = await this.applyOwnColumnsOfUpdateAll(where, own, increments, inTransaction);

            const givesRowsById: boolean = OwnedRelationUtilities
                .resolveWrites(OwnedRelationUtilities.resolveAll(this.entityClass), [[owned ?? {}, '']])
                .some(w => w.keptIds.length > 0);
            if (givesRowsById && res.updates.length > 1) {
                throw new InternalError([
                    `updateAll on "${this.entityClass.name}" gave a related row by its id to ${res.updates.length} rows.`,
                    'A row of a one to many or has one relation belongs to one row only. Use updateById.'
                ]);
            }
            await this.writeOwnedRows(
                res.updates.map(({ entity }): [Record<string, unknown>, string, string | undefined] => [
                    { ...owned, id: entity.id },
                    String(entity.id),
                    TenantUtilities.resolveTenantOf(entity, this.entityClass)
                ]),
                inTransaction,
                false
            );
            return res;
        });
    }

    /**
     * Updates the columns of the rows an update with relation values matches, and finds those rows.
     *
     * Data that gave nothing but relation values has no column to write, and a store refuses an
     * update statement without one - so the rows are found with the same narrowing the write applies.
     * @param where - The where filter to find the entities that should be updated.
     * @param own - The data, with the relation values taken off.
     * @param increments - The amounts to add to what the entities store, by property.
     * @param options - The options of the update, holding its transaction.
     * @returns Each matched row with the change written to it.
     */
    private async applyOwnColumnsOfUpdateAll(
        where: Where<T>,
        own: UpdateData,
        increments: IncrementAmounts,
        options: UpdateAllOptions<T, boolean>
    ): Promise<BulkUpdate<T>> {
        if (Object.keys(own).length || Object.keys(increments).length) {
            return await this.applyUpdateAll(where, own, increments, options, true);
        }
        const reach: ScopedWhere<T> = this.resolveWriteWhere(where, options);
        if (reach.matchesNothing) {
            return { count: 0, updates: [] };
        }
        const rows: T[] = await this.findAll({
            ...options,
            where: reach.where,
            limit: 'all',
            relations: [],
            autoDecrypt: false
        });
        return { count: rows.length, updates: rows.map(entity => ({ entity, written: {} as UpdateData })) };
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
     * first is how this learns which ids to bind to. The write is still a single call: `updateEach` is
     * the driver's primitive for writing many rows that each carry their own values.
     *
     * The read does widen a window that was always there. A row inserted while this is running is not
     * updated - but neither is one inserted while a plain update statement is running, at the
     * isolation level either of them gets by default. What changes is how long that window is, from
     * the length of a statement to the length of a read plus a write. A caller who needs the two to
     * be one thing hands in a transaction and picks its isolation level; both halves run inside it.
     * @param where - The filter naming the rows to update.
     * @param data - The data to update them with.
     * @param increments - The amounts to add to what the rows store, by property.
     * @param boundProperties - The properties in that data which are bound to their row.
     * @param judging - The scope the caller is restricted to, and the added properties it reads.
     * @param options - Additional options, like a transaction.
     * @returns Each updated row with the change that produced it, which here really is one per row.
     */
    private async updateAllBound(
        where: Where<T>,
        data: UpdateData,
        increments: IncrementAmounts,
        boundProperties: string[],
        judging: IncrementJudging<T>,
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
                limit: 'all',
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
                const single: UpdateData = { ...WriteDataUtilities.copy(data, this.entityClass), id: row.id };
                await this.beforeSave(single, SaveOperation.UPDATE);
                await this.applyScopeToData(single, SaveOperation.UPDATE, options);
                return single;
            });
            // each row was read, so each is checked against its own tenant
            const tenantOfRow: Map<string, string | undefined> = new Map(
                rows.map(row => [row.id, TenantUtilities.resolveTenantOf(row, this.entityClass)])
            );
            await this.validateReferences(
                rowData.map(single => ({ data: single, rowTenant: tenantOfRow.get(String(single.id)) })),
                { ...options, transaction }
            );

            // each row with its own values, which is what updateEach writes - and unlike a save, it
            // merges an object into the stored one, as every other update does
            const ids: Where<T> = { id: { oneOf: rows.map(r => r.id) } } as Where<T>;
            let written: T[] = await this.driver.updateEach(rowData, ids, transaction);
            if (Object.keys(increments).length) {
                // the amounts in a write of their own, in the same transaction: each row's values are
                // its own here, and an amount adds to what is stored either way
                const nothingElse: DeepPartial<T> = {} as DeepPartial<T>;
                written = await this.driver.updateAll({ where: ids, data: nothingElse, increments, transaction, returnUpdated: true });
            }
            for (const entity of written) {
                this.validateWithinScope(entity, judging.judgedAfter, judging.scope);
            }
            const updated: T[] = await this.writtenEntities(written, { ...options, transaction });
            // paired by id rather than by position: `rowData` was built from the rows this read, and
            // what the driver hands back is its own list. They hold the same rows, and nothing says
            // they hold them in the same order.
            return updated.map(entity => ({
                entity,
                written: this.resolveWritten(rowData.find(d => d.id === entity.id) ?? { ...data, id: entity.id }, increments, entity)
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
     * Runs the given work under the timeout the caller's options name, when they name one.
     *
     * Everything the call does runs under it: each statement may take that long, in place of the data
     * source's statement timeout, and the call as a whole as well. A method of a subclass wraps itself
     * as well as the method it delegates to, and the inner limit is then the same as the outer one.
     * @param options - The options the caller provided, holding their timeout if they named one.
     * @param method - The name of the call, for the error a timeout fails with.
     * @param fn - The work to run.
     * @returns Whatever the work returned.
     */
    protected async withinTimeout<R>(
        options: BaseRepositoryOptions | undefined,
        method: string,
        fn: () => Promise<R>
    ): Promise<R> {
        if (options?.timeoutInMs == undefined) {
            return await this.resolvingRestrictionsOnce(fn);
        }
        return await OperationLimitUtilities.runWithin(
            options.timeoutInMs,
            `${this.entityClass.name}.${method}`,
            async () => await this.resolvingRestrictionsOnce(fn)
        );
    }

    /**
     * Runs a call so that every step of it shares the restrictions it resolves, see
     * {@link callRestrictions}. A call made from inside another one of this repository joins it.
     * @param fn - The call.
     * @returns Whatever the call returned.
     */
    private async resolvingRestrictionsOnce<R>(fn: () => Promise<R>): Promise<R> {
        if (this.callRestrictions.getStore()?.open === true) {
            return await fn();
        }
        const call: CallRestrictions<T> = { open: true, resolved: [] };
        try {
            return await this.callRestrictions.run(call, fn);
        }
        finally {
            call.open = false;
            call.resolved.length = 0;
        }
    }

    /**
     * Deletes an entity with the provided id.
     *
     * With a `where`, the row is deleted only while it meets that condition as well, which is checked
     * as part of the delete. A row the caller may see that no longer meets it fails the call with a
     * `ConflictError`, any other with a `NotFoundError`.
     * @param id - The id of the entity to deleted.
     * @param options - Additional options, like a transaction, a condition, or the relations the
     * deleted entity is handed back with.
     * @returns The deleted entity.
     * @throws An InternalError when the entity declares optimistic locking and the condition does not
     * name the locked properties.
     */
    async deleteById(id: T['id'], options?: DeleteByIdOptions<T>): Promise<T> {
        return await this.withinTimeout(options, 'deleteById', async () => {
            validateWriteIsNotBlind(this.entityClass, undefined, options?.where);
            const entityToDelete: T = await this.resolveRowToDelete(id, options);
            this.validateWritable(entityToDelete, options);
            await this.beforeDelete(entityToDelete);

            // the condition again, judged as the row is removed: the read above is what keeps a hook
            // from running for a row that is not deleted, this is what keeps a write in between from
            // being deleted over
            await this.removeRows([entityToDelete.id], options, await this.resolveRemovalReach(options?.where, options, true));
            // not decrypted again: the read above already did, and a delete writes nothing back
            await this.beforeReturn(entityToDelete, false);
            return entityToDelete;
        });
    }

    /**
     * Finds the row a delete by id removes, under the condition the caller gave.
     * @param id - The id of the row.
     * @param options - The options of the delete, holding the condition and the relations to read.
     * @returns The row.
     * @throws A conflict when the row is there and no longer meets the condition, a not found when it
     * is not there for the caller, as {@link validateUpdateWasWritten} answers an update.
     */
    protected async resolveRowToDelete(id: T['id'], options: DeleteByIdOptions<T> | undefined): Promise<T> {
        const found: T | undefined = await this.findById(id, { ...options, required: false });
        if (found != undefined) {
            return found;
        }
        // read without the condition only once the row was not found with it, and through the scope,
        // so which answer comes back tells the caller nothing they could not read
        const visible: T | undefined = options?.where == undefined
            ? undefined
            : await this.findById(id, { ...options, where: undefined, required: false });
        if (visible != undefined) {
            this.validateWritable(visible, options);
            throw new ConflictError($ts`The ${this.entityClass.name} with id "${id}" changed since it was read, so it was not deleted.`);
        }
        throw new NotFoundError($ts`Could not find ${this.entityClass.name} with id "${id}".`);
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
        return await this.withinTimeout(options, 'deleteAll', async () => {
            validateWriteIsNotBlind(this.entityClass, undefined, where);
            const res: T[] | number = await this.applyDeleteAll(where, options);
            if (typeof res === 'number') {
                return res as R extends true ? T[] : number;
            }
            return (options?.returnDeleted === true ? res : res.length) as R extends true ? T[] : number;
        });
    }

    /**
     * The one implementation behind {@link deleteAll}.
     *
     * Reads the rows it is about to remove when somebody is handed them: the caller asking for them
     * back, or a before delete hook of the application's own, which runs for each one. Otherwise only
     * their ids are read, since removing a row needs nothing else.
     * @param where - The where filter to find the entities that should be deleted.
     * @param options - Additional options, like a transaction.
     * @returns The deleted entities, or how many were deleted when none of them were read.
     */
    private async applyDeleteAll(
        where: Where<T>,
        options?: DeleteAllOptions<T, boolean>
    ): Promise<T[] | number> {
        const reach: ScopedWhere<T> = this.resolveWriteWhere(where, options);
        if (reach.matchesNothing) {
            return [];
        }

        // the default hook does nothing with a row on its way out that is not handed back, so a count
        // needs to know which rows go away and nothing about them - without holding, decrypting or
        // resolving a large match to throw it away (01-data-layer M50). A before delete hook of the
        // application's own is handed every row, as it always is
        if (options?.returnDeleted !== true && !this.hasBeforeDelete()) {
            const scoped: ScopedWhere<T> = await this.scopedWhere(reach.where, options);
            if (scoped.matchesNothing) {
                return 0;
            }
            const ids: string[] = await this.driver.findIds(await this.toDriverFindOptions({ ...options, limit: 'all' }, scoped.where));
            return await this.removeRows(
                ids,
                options,
                scoped.where == undefined ? undefined : { where: scoped.where, related: await this.resolveRelated(scoped.where, undefined, options), wholly: false }
            );
        }
        // before the read below rather than after it, which is the whole point: the read is what
        // would have held every matching entity at once. Scoped first, so what is counted is what
        // this caller can see rather than what the table holds
        if (options?.returnDeleted === true) {
            const scoped: ScopedWhere<T> = await this.scopedWhere(reach.where, options);
            if (scoped.matchesNothing) {
                return [];
            }
            await this.validateReturnIsBounded(scoped.where, options.transaction);
        }

        // every matching row, because every matching row is handed to somebody: the hook, and the
        // caller when they asked for them
        const toDelete: T[] = await this.findAll({ where: reach.where, ...options, limit: 'all' });
        await Promise.all(toDelete.map(r => this.beforeDelete(r)));

        await this.removeRows(toDelete.map(r => r.id), options, await this.resolveRemovalReach(reach.where, options, true));
        // only for a caller who is being handed the rows, and without decrypting them again - the
        // read above already did. What is left of this hook is hiding what an entity excludes, which
        // is about what somebody receives, and a caller counting what went away receives none of it
        if (options?.returnDeleted === true) {
            await Promise.all(toDelete.map(r => this.beforeReturn(r,false)));
        }
        return toDelete;
    }

    /**
     * Whether a before delete hook of the application's own runs on every row a delete removes: an
     * override of `beforeDelete`, or one provided under `ZIBRI_DI_TOKENS.REPOSITORY_HOOKS`.
     * @returns True when one does.
     */
    private hasBeforeDelete(): boolean {
        return this.beforeDelete !== Repository.prototype.beforeDelete || RepositoryHookUtilities.hasBeforeDelete();
    }

    /**
     * Removes rows from the store, with the rows of their relations that cascade removes, and with
     * users their memberships and every row auth keeps for them.
     *
     * Here rather than in whatever deletes users, so that it holds for every way of deleting one: a
     * membership, a password or a passkey names its user only by id, and nothing else would remove it.
     * In one transaction, so a user is never gone while their rows stay.
     *
     * A delete of rows a caller read hands their reach along, which the store judges as it removes
     * them: a row another caller moved out of it since is not removed. Where the rows were handed to
     * somebody, or rows of theirs went with them, that fails the whole delete instead, which removes
     * none of them; a delete that only counts removes the others.
     * @param ids - The ids of the rows to remove.
     * @param options - The options the caller provided, holding their transaction if they had one.
     * @param reach - What the rows have to match as they are removed, or undefined for every one of them.
     * @returns How many rows were removed.
     * @throws A conflict when rows of a relation that does not cascade removes still point at one of
     * them, or when a row left the reach and the whole delete fails for it.
     */
    protected async removeRows(ids: string[], options: BaseRepositoryOptions | undefined, reach?: RemovalReach<T>): Promise<number> {
        // a delete that matched nothing - the rows a save left out, when it left none out - removes
        // nothing, and asks the store for nothing
        if (!ids.length) {
            return 0;
        }
        const userService: UserServiceInterface = inject(ZIBRI_DI_TOKENS.USER_SERVICE);
        const isUser: boolean = userService.isUserEntity(this.entityClass);
        const relations: OwnedRelation[] = OwnedRelationUtilities.resolveAll(this.entityClass);
        const remove: (transaction: Transaction | undefined, within: RemovalReach<T> | undefined) => Promise<number> = async (transaction, within) => {
            const removed: string[] = await this.driver.remove(ids, within, transaction);
            WrittenRowTenantUtilities.forget(transaction, this.entityClass, removed);
            if (within?.wholly === true && removed.length < ids.length) {
                throw new ConflictError(
                    $ts`A ${this.entityClass.name} to delete changed since it was read, so none was deleted.`
                );
            }
            return removed.length;
        };
        // one call, which judges the reach as it removes - wholly or not, which the store keeps in
        // that same call rather than this holding the rows in a transaction around it
        if (!isUser && !relations.length) {
            return await remove(this.writeTransaction(options), reach);
        }
        return await this.inTransaction(options, async transaction => {
            await this.removeOwnedRows(ids, relations.filter(r => r.cascadesRemove), transaction);
            // after the rows removed along with these, the way a foreign key is checked once the
            // whole delete is done: a row pointing at its owner through a second relation that does
            // not remove it is gone by then, if the first one removed it. Checked by the repository
            // rather than left to the stores, because only some of them have foreign keys - the
            // others would delete the row and leave the ones pointing at it pointing at nothing
            await this.validateNotReferenced(ids, relations.filter(r => !r.cascadesRemove), transaction);
            // wholly when anything went with the rows: what was removed along with a row that stays
            // is undone only by failing the transaction
            const removed: number = await remove(transaction, reach == undefined ? undefined : { ...reach, wholly: true });
            if (isUser) {
                const membershipService: MembershipServiceInterface = inject(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE);
                await membershipService.deleteMemberships(ids, transaction);
                const authService: AuthServiceInterface = inject(ZIBRI_DI_TOKENS.AUTH_SERVICE);
                await authService.deleteUserRows(ids, transaction);
            }
            return removed;
        });
    }

    /**
     * Resolves what the rows of a delete have to match as they are removed: what the caller may
     * change, with the condition they gave.
     * @param where - The condition of the delete, if it had one.
     * @param options - The options of the delete.
     * @param wholly - Whether every one of the rows is removed or none of them, since somebody was
     * handed them before.
     * @returns The reach, or undefined when nothing restricts what the caller may delete.
     */
    private async resolveRemovalReach(
        where: Where<T> | undefined,
        options: BaseRepositoryOptions | undefined,
        wholly: boolean
    ): Promise<RemovalReach<T> | undefined> {
        const writable: ScopedWhere<T> = this.resolveWriteWhere(where, options);
        const scoped: ScopedWhere<T> = writable.matchesNothing ? writable : await this.scopedWhere(writable.where, options);
        if (scoped.where == undefined) {
            return undefined;
        }
        return { where: scoped.where, related: await this.resolveRelated(scoped.where, undefined, options), wholly };
    }

    /**
     * Deletes the rows of the given relations of rows about to be removed, through the repository of
     * their entity - which deletes the rows of their own relations in turn.
     *
     * Every row of them, whoever may see it: the delete of their owner was allowed, and a row left
     * behind would point at nothing. A soft deleted entity's rows are deleted for good, because a row
     * that is only marked deleted would still point at the owner.
     * @param ownerIds - The ids of the rows about to be removed.
     * @param relations - Their relations that cascade removes.
     * @param transaction - The transaction the removal runs in.
     */
    private async removeOwnedRows(ownerIds: string[], relations: OwnedRelation[], transaction: Transaction): Promise<void> {
        const childOptions: BaseRepositoryOptions = { transaction, unscoped: true, acrossTenants: true };
        for (const relation of relations) {
            // whatever their locked properties hold: what the delete was based on was checked on the owner
            const where: Where<BaseEntity> = ModelRegistry.get(relation.target).optimisticLockDescriptor
                .resolveRegardlessWhere(OwnedRelationUtilities.resolveRemovedWithWhere(relation, ownerIds));
            if (isSoftDeleteEntityNewable(relation.target)) {
                await this.dataSource.getRepository(relation.target).deleteAll(where, { ...childOptions, hardDelete: true });
                continue;
            }
            await this.dataSource.getRepository(relation.target).deleteAll(where, childOptions);
        }
    }

    /**
     * Refuses removing rows that rows of the given relations still point at - every row of them,
     * whoever may see it, and soft deleted ones too, which still point at their owner.
     * @param ownerIds - The ids of the rows about to be removed.
     * @param relations - Their relations that do not cascade removes.
     * @param transaction - The transaction the removal runs in.
     * @throws A conflict naming the first relation whose rows still point at one of them.
     */
    private async validateNotReferenced(ownerIds: string[], relations: OwnedRelation[], transaction: Transaction): Promise<void> {
        const childOptions: BaseRepositoryOptions = { transaction, unscoped: true, acrossTenants: true };
        for (const relation of relations) {
            const where: Where<BaseEntity> = OwnedRelationUtilities.resolveStillReferencingWhere(relation, ownerIds, this.entityClass);
            const referenced: boolean = isSoftDeleteEntityNewable(relation.target)
                ? await this.dataSource.getRepository(relation.target).exists({ ...childOptions, where, deleted: 'include' })
                : await this.dataSource.getRepository(relation.target).exists({ ...childOptions, where });
            if (referenced) {
                throw new ConflictError(
                    $ts`The ${this.entityClass.name} cannot be deleted while rows of "${relation.key}" still point at it.`
                );
            }
        }
    }
}