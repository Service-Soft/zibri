import { DriverFindAndCountOptions, DriverFindOptions, DriverStreamOptions, DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { AlsUtilities } from '../../context/als.utilities';
import { BaseEntity } from '../../entity/base-entity.model';
import { PaginationResult } from '../../open-api/pagination-result.model';
import { DeepPartial } from '../../types/deep-partial.type';
import { AtomicUpdate } from '../models/atomic-update.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * Refuses a store operation whose request is already over.
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

    // eslint-disable-next-line jsdoc/require-jsdoc
    async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        this.validateStillWanted();
        return await this.inner.save(data, transaction, reload);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async find(options: DriverFindOptions<T>): Promise<T[]> {
        this.validateStillWanted();
        return await this.inner.find(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findOne(options: DriverFindOptions<T>): Promise<T | undefined> {
        this.validateStillWanted();
        return await this.inner.findOne(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async count(options: DriverFindOptions<T>): Promise<number> {
        this.validateStillWanted();
        return await this.inner.count(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async findAndCount(options: DriverFindAndCountOptions<T>): Promise<PaginationResult<T>> {
        this.validateStillWanted();
        return await this.inner.findAndCount(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async remove(entities: T[], transaction: Transaction | undefined): Promise<T[]> {
        this.validateStillWanted();
        return await this.inner.remove(entities, transaction);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        this.validateStillWanted();
        return await this.inner.updateAll(options);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async upsert(
        identity: DeepPartial<T>,
        create: DeepPartial<T>,
        onConflict: AtomicUpdate<T>,
        transaction: Transaction | undefined
    ): Promise<T> {
        this.validateStillWanted();
        return await this.inner.upsert(identity, create, onConflict, transaction);
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
     * Checks that the request this is running in has not already been answered without it.
     * @throws Whatever the request was abandoned with, which is the deadline's own error.
     */
    private validateStillWanted(): void {
        const signal: AbortSignal | undefined = AlsUtilities.findCurrentRequestSignal();
        if (signal?.aborted === true) {
            throw signal.reason;
        }
    }
}