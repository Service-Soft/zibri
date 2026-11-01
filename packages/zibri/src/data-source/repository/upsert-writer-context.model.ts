import { BaseEntity } from '../../entity/base-entity.model';
import { type DenyAll } from '../../entity/models/entity-scope.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { SaveOperation } from '../hooks/before-save';
import { BaseRepositoryOptions } from '../models/options/base-repository-options.model';
import { FindAllOptions } from '../models/options/find-all-options.model';
import { type RelatedNarrowing } from '../models/related-narrowing.model';
import { Where } from '../models/where/where-filter.model';
import { type RepositoryTransaction } from '../transaction/repository-transaction.type';

/**
 * What an upsert takes from the repository it writes for: its hooks and its reads, as the repository
 * and whatever extends it answer them.
 */
export type UpsertWriterContext<T extends BaseEntity> = {
    /**
     * Runs the before save hooks on a row.
     */
    beforeSave: (data: T | DeepPartial<T>, operation: SaveOperation) => Promise<void>,
    /**
     * Refuses a row that would fall outside the given scope.
     */
    validateWithinScope: (data: DeepPartial<T>, judged: 'every' | string[], scope: Where<T> | DenyAll | undefined) => void,
    /**
     * Reads rows the way the repository reads them.
     */
    findAll: (options: FindAllOptions<T>) => Promise<T[]>,
    /**
     * Resolves what the rows a filter reaches through relations are narrowed to.
     */
    resolveRelated: (where: Where<T> | undefined, options: BaseRepositoryOptions<T> | undefined) => Promise<RelatedNarrowing | undefined>,
    /**
     * Runs work in the caller's transaction, or in one taken out for it.
     */
    inTransaction: <R>(options: BaseRepositoryOptions<T> | undefined, fn: (transaction: RepositoryTransaction<T>) => Promise<R>) => Promise<R>
};