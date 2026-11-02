import { RemovalReach } from './removal-reach.model';
import { DriverAggregateOptions, DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { AggregateRow } from '../models/aggregate.model';
import { FindAllOptions } from '../models/options/find-all-options.model';
import { PaginationResult } from '../models/pagination-result.model';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { type RepositoryTransaction } from '../transaction/repository-transaction.type';
import { Transaction } from '../transaction/transaction.model';

/**
 * A driver that hands every operation to the one it wraps.
 *
 * The base of every driver that adds something around a store operation: it overrides the
 * operations it adds to and inherits the rest, so a wrapper is only as long as what it does.
 */
export abstract class ForwardingRepositoryDriver<T extends BaseEntity, X extends RepositoryTransaction = Transaction>
implements RepositoryDriverInterface<T, X> {
    constructor(protected readonly inner: RepositoryDriverInterface<T, X>) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: X | undefined, reload: boolean): Promise<T[]> {
        return await this.inner.save(data, transaction, reload);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async insert(data: DeepPartial<T>[], transaction: X | undefined): Promise<T[]> {
        return await this.inner.insert(data, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: X | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        return await this.inner.updateEach(rows, where, transaction, related);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async find(options: DriverFindOptions<T, X>): Promise<T[]> {
        return await this.inner.find(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveRelations(
        entities: T[],
        relations: FindAllOptions<T>['relations'],
        related: RelatedNarrowing | undefined,
        transaction: X | undefined
    ): Promise<T[]> {
        return await this.inner.resolveRelations(entities, relations, related, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne(options: DriverFindOptions<T, X>): Promise<T | undefined> {
        return await this.inner.findOne(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async count(options: DriverFindOptions<T, X>): Promise<number> {
        return await this.inner.count(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async aggregate(options: DriverAggregateOptions<T, X>): Promise<AggregateRow[]> {
        return await this.inner.aggregate(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T, X>): Promise<PaginationResult<T>> {
        return await this.inner.findAndCount(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    stream(options: DriverStreamOptions<T, X>): AsyncIterable<T> {
        return this.inner.stream(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async remove(ids: string[], reach: RemovalReach<T> | undefined, transaction: X | undefined): Promise<string[]> {
        return await this.inner.remove(ids, reach, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async removeMatching(
        where: Where<T> | undefined,
        related: RelatedNarrowing | undefined,
        transaction: X | undefined
    ): Promise<string[]> {
        return await this.inner.removeMatching(where, related, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findIds(options: DriverFindOptions<T, X>): Promise<string[]> {
        return await this.inner.findIds(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R, X>): Promise<R extends true ? T[] : number> {
        return await this.inner.updateAll(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: X | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        return await this.inner.upsert(identity, rows, transaction, reachable, related);
    }
}