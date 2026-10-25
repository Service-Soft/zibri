import { DriverAggregateOptions, DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { PaginationResult } from '../../open-api/pagination-result.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { AggregateRow } from '../models/aggregate.model';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * A driver that hands every operation to the one it wraps.
 *
 * The base of every driver that adds something around a store operation: it overrides the
 * operations it adds to and inherits the rest, so a wrapper is only as long as what it does.
 */
export abstract class ForwardingRepositoryDriver<T extends BaseEntity> implements RepositoryDriverInterface<T> {
    constructor(protected readonly inner: RepositoryDriverInterface<T>) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        return await this.inner.save(data, transaction, reload);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        return await this.inner.insert(data, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: Transaction | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        return await this.inner.updateEach(rows, where, transaction, related);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async find(options: DriverFindOptions<T>): Promise<T[]> {
        return await this.inner.find(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        return await this.inner.findOne(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async count(options: DriverFindOptions<T>): Promise<number> {
        return await this.inner.count(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async aggregate(options: DriverAggregateOptions<T>): Promise<AggregateRow[]> {
        return await this.inner.aggregate(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        return await this.inner.findAndCount(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        return this.inner.stream(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async remove(ids: string[], transaction: Transaction | undefined): Promise<void> {
        await this.inner.remove(ids, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIds(options: DriverFindOptions<T>): Promise<string[]> {
        return await this.inner.findIds(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        return await this.inner.updateAll(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        return await this.inner.upsert(identity, rows, transaction, reachable, related);
    }
}