import { DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface.ts';
import { AlsUtilities } from '../../context/als.utilities.ts';
import { BaseEntity } from '../../entity/base-entity.model.ts';
import { PaginationResult } from '../../open-api/pagination-result.model.ts';
import { DeepPartial } from '../../types/deep-partial.type.ts';
import { UpsertRow } from '../models/upsert-row.model.ts';
import { Where } from '../models/where/where-filter.model.ts';
import { Transaction } from '../transaction/transaction.model.ts';

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
export class DeadlineAwareRepositoryDriver<T extends BaseEntity> implements RepositoryDriverInterface<T> {
    constructor(private readonly inner: RepositoryDriverInterface<T>) {}

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        this.validateStillWanted();
        return await this.inner.save(data, transaction, reload);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        this.validateStillWanted();
        return await this.inner.insert(data, transaction);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async updateEach(rows: DeepPartial<T>[], where: Where<T>, transaction: Transaction | undefined): Promise<T[]> {
        this.validateStillWanted();
        return await this.inner.updateEach(rows, where, transaction);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async find(options: DriverFindOptions<T>): Promise<T[]> {
        this.validateStillWanted();
        return await this.inner.find(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        this.validateStillWanted();
        return await this.inner.findOne(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async count(options: DriverFindOptions<T>): Promise<number> {
        this.validateStillWanted();
        return await this.inner.count(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        this.validateStillWanted();
        return await this.inner.findAndCount(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async remove(ids: string[], transaction: Transaction | undefined): Promise<void> {
        this.validateStillWanted();
        await this.inner.remove(ids, transaction);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async findIds(options: DriverFindOptions<T>): Promise<string[]> {
        this.validateStillWanted();
        return await this.inner.findIds(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        this.validateStillWanted();
        return await this.inner.updateAll(options);
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined
    ): Promise<T[]> {
        this.validateStillWanted();
        return await this.inner.upsert(identity, rows, transaction, reachable);
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
    async* stream(options: DriverStreamOptions<T>): AsyncIterable<T> {
        this.validateStillWanted();
        for await (const row of this.inner.stream(options)) {
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