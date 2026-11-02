import { Transaction } from './transaction.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { type LoggerInterface } from '../../logging/logger.interface';

/**
 * The transactions a data source started that are not committed or rolled back yet, so that it can
 * roll them back as it shuts down.
 */
export class OpenTransactions {
    private readonly transactions: Set<Transaction> = new Set();

    /**
     * Holds on to a transaction until it is committed or rolled back.
     * @param transaction - The transaction, just started.
     */
    add(transaction: Transaction): void {
        this.transactions.add(transaction);
        transaction.afterFinish(async () => {
            this.transactions.delete(transaction);
            await Promise.resolve();
        });
    }

    /**
     * Rolls back every transaction that is still open, and reports that it did.
     * @param dataSourceName - The name of the data source, which the report names.
     * @param logger - Where the report goes.
     */
    async rollBackAll(dataSourceName: string, logger: LoggerInterface): Promise<void> {
        const open: Transaction[] = [...this.transactions];
        if (!open.length) {
            return;
        }
        const several: boolean = open.length > 1;
        logger.error(new InternalError(
            `${open.length} ${several ? 'transactions' : 'transaction'} of the data source "${dataSourceName}"`
            + ` ${several ? 'were' : 'was'} still open when it shut down. ${several ? 'They have' : 'It has'} been rolled back.`
        ));
        await Promise.all(open.map(async transaction => {
            try {
                await transaction.rollback();
            }
            catch (error) {
                // the shutdown goes on: one transaction that cannot be rolled back is no reason to
                // leave the others open, or the connections closing after them
                logger.error(error instanceof Error ? error : new InternalError(String(error)));
            }
        }));
    }
}