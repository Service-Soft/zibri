import { ForwardingRepositoryDriver } from './forwarding.repository-driver';
import { DriverAggregateOptions, DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions } from './repository-driver.interface';
import { AlsUtilities } from '../../context/als.utilities';
import { BaseEntity } from '../../entity/base-entity.model';
import { PaginationResult } from '../../open-api/pagination-result.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { AggregateRow } from '../models/aggregate.model';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * Refuses a store operation whose request is already over, or whose work has run out of the time it
 * was given.
 *
 * A handler that has been answered without it goes on running, and most of what it does next is
 * read and write a store for a caller who will never see any of it. One query cannot be taken back,
 * but the next four can simply not be made - which is where most of the cost of an abandoned handler
 * actually is.
 *
 * Wrapped around the driver rather than written into the repository above it, for the reason the
 * traced driver gives: there is one seam here and fourteen up there. Outside the traced one, so that
 * an operation which never reached the store leaves no span claiming it did.
 *
 * Every method forwards. What is added is the refusal in front of it.
 */
export class DeadlineAwareRepositoryDriver<T extends BaseEntity> extends ForwardingRepositoryDriver<T> {

    override async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        this.validateStillWanted();
        return await super.save(data, transaction, reload);
    }

    override async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        this.validateStillWanted();
        return await super.insert(data, transaction);
    }

    override async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: Transaction | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        this.validateStillWanted();
        return await super.updateEach(rows, where, transaction, related);
    }

    override async find(options: DriverFindOptions<T>): Promise<T[]> {
        this.validateStillWanted();
        return await super.find(options);
    }

    override async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        this.validateStillWanted();
        return await super.findOne(options);
    }

    override async count(options: DriverFindOptions<T>): Promise<number> {
        this.validateStillWanted();
        return await super.count(options);
    }

    override async aggregate(options: DriverAggregateOptions<T>): Promise<AggregateRow[]> {
        this.validateStillWanted();
        return await super.aggregate(options);
    }

    override async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        this.validateStillWanted();
        return await super.findAndCount(options);
    }

    override async remove(ids: string[], transaction: Transaction | undefined): Promise<void> {
        this.validateStillWanted();
        await super.remove(ids, transaction);
    }

    override async findIds(options: DriverFindOptions<T>): Promise<string[]> {
        this.validateStillWanted();
        return await super.findIds(options);
    }

    override async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        this.validateStillWanted();
        return await super.updateAll(options);
    }

    override async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        this.validateStillWanted();
        return await super.upsert(identity, rows, transaction, reachable, related);
    }

    /**
     * Reads rows one at a time, stopping when nobody is waiting for them any more.
     *
     * Checked per batch rather than once at the start, because a stream is the one operation whose
     * whole point is to outlast a single answer - a deadline reached halfway through is the case
     * this exists for rather than an edge of it.
     * @param options - What to read.
     * @yields Each row the store answers with.
     */
    override async* stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        this.validateStillWanted();
        for await (const row of super.stream(options)) {
            this.validateStillWanted();
            yield row;
        }
    }

    /**
     * Checks that the request this is running in has not already been answered without it, and that
     * the work it belongs to has not run out of the time it was given.
     * @throws Whatever the request or the work was abandoned with, which is the deadline's own error.
     */
    private validateStillWanted(): void {
        const signal: AbortSignal | undefined = AlsUtilities.findCurrentSignal();
        if (signal?.aborted === true) {
            throw signal.reason;
        }
    }
}