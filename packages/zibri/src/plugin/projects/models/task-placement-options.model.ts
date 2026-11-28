import { type RepositoryTransaction } from '../../../data-source/transaction/repository-transaction.type';

/**
 * How `resolveTaskPlacement` reads and writes the tasks of a column.
 */
export type TaskPlacementOptions = {
    /**
     * The transaction to read and write in, or undefined for one of its own when it writes.
     */
    transaction: RepositoryTransaction | undefined,
    /**
     * Whether it reaches past what the caller sees, as work outside a request does.
     */
    unscoped: boolean
};
