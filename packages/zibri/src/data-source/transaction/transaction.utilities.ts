import { RunInTransactionOptions } from './run-in-transaction-options.model';
import { TransactionConflictError } from './transaction-conflict.error';
import { Transaction } from './transaction.model';
import { AlsUtilities } from '../../context/als.utilities';
import { InternalError } from '../../error-handling/internal-error.model';
import { type RepositoryTransaction } from './repository-transaction.type';
import { type BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { ChainUtilities } from '../chain/chain.utilities';
import { DataSourceInterface } from '../data-sources/data-source.interface';
import { BaseRepositoryOptions } from '../models/options/base-repository-options.model';

/**
 * Utilities for working with transactions, whichever data source started them.
 */
export abstract class TransactionUtilities {
    /**
     * Resolves the transaction of a **write** and records it when one is running under a lease.
     *
     * Only writes go through here. A read inside an open transaction is harmless, while a write is
     * the thing a grant stops covering once the commit moves outside it.
     * @param options - The options the write was called with.
     * @returns The transaction to hand to the driver, if any.
     */
    static resolveWriteTransaction<T extends BaseEntity>(options?: BaseRepositoryOptions<T>): RepositoryTransaction<T> | undefined {
        if (options?.transaction != undefined) {
            AlsUtilities.recordTransactionInLeaseScope(options.transaction);
        }
        return options?.transaction;
    }

    /**
     * Refuses a spanning transaction where only a transaction of one data source is taken.
     * @param transaction - The transaction.
     * @param reason - Why it is refused, which the error leads with.
     * @throws When it is a spanning transaction.
     */
    static validateNotSpanning(
        transaction: RepositoryTransaction | undefined,
        reason: string
    ): asserts transaction is Transaction | undefined {
        if (transaction?.spansDataSources === true) {
            throw new InternalError(`${reason}, so it takes no spanning transaction.`);
        }
    }

    /**
     * Resolves a transaction handed on from the write of one entity as the transaction a repository
     * of another entity takes.
     * @param transaction - The transaction.
     * @param entityClass - The entity it is handed to.
     * @returns The same transaction.
     * @throws When it is a spanning transaction and the entity is chained.
     */
    static resolveRepositoryTransaction<T extends BaseEntity>(
        transaction: RepositoryTransaction | undefined,
        entityClass: Newable<T>
    ): RepositoryTransaction<T> | undefined {
        if (ChainUtilities.isChained(entityClass)) {
            this.validateNotSpanning(transaction, `${entityClass.name} is chained, and a row of a chain cannot be restored`);
        }
        // checked above, which is what the conditional type cannot see for an entity it does not know:
        // only a chained one takes nothing but a transaction of its data source
        return transaction as RepositoryTransaction<T> | undefined;
    }

    /**
     * Runs work in a transaction of its own, and runs it again from the start when a conflict with
     * another transaction ended it.
     * @param dataSource - The data source to start the transaction on.
     * @param work - The work, which writes through the transaction it is given and neither commits
     * nor rolls it back.
     * @param options - How the transaction is started, and how often the work is run at most.
     * @returns What the work returned, once the transaction is committed.
     * @throws What the work or the commit failed with, after rolling back. A conflict only once the
     * work has run as often as it may.
     */
    static async runInTransaction<R>(
        dataSource: Pick<DataSourceInterface, 'startTransaction'>,
        work: (transaction: Transaction) => Promise<R>,
        options: RunInTransactionOptions
    ): Promise<R> {
        const { maxAttempts, ...startOptions } = options;
        if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
            throw new InternalError(`maxAttempts has to be a whole number of at least 1, but is ${maxAttempts}.`);
        }
        for (let attempt: number = 1; ; attempt++) {
            const transaction: Transaction = await dataSource.startTransaction(startOptions);
            try {
                const result: R = await work(transaction);
                await transaction.commit();
                return result;
            }
            catch (error) {
                // a commit that failed has ended the transaction already
                if (!transaction.isFinished) {
                    await transaction.rollback();
                }
                // nothing it wrote is applied, so running it again is the same as running it first
                if (!(error instanceof TransactionConflictError) || attempt >= maxAttempts) {
                    throw error;
                }
            }
        }
    }
}