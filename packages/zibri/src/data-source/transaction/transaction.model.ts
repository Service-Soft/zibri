/**
 * Defines a transaction.
 *
 * The concrete shape of a transaction depends on the data source that started it,
 * eg. A TypeOrmTransaction holds a typeorm query runner while a ValKeyTransaction
 * buffers the commands until they are applied inside a single atomic batch.
 */
export type Transaction = {
    /**
     * Whether the transaction has already been committed or rolled back.
     *
     * Exposed so that a lock can tell whether a write made while it was held has actually landed, or
     * is still waiting on a commit that will happen after the lock is gone.
     */
    readonly isFinished: boolean,
    /**
     * Commits the transaction.
     */
    commit: () => void | Promise<void>,
    /**
     * Rolls back the transaction.
     */
    rollback: () => void | Promise<void>
};