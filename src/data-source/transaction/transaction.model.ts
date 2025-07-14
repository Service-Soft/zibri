import { QueryRunner } from 'typeorm';

/**
 * Defines a transaction.
 */
export type Transaction = {
    /**
     * A query runner that handles the transaction.
     */
    queryRunner: QueryRunner,
    /**
     * Commits the transaction.
     */
    commit: () => Promise<void>,
    /**
     * Rolls back the transaction.
     */
    rollback: () => Promise<void>
};