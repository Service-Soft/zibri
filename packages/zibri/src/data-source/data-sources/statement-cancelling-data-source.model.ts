import { QueryRunner } from 'typeorm';

/**
 * A store that can stop a statement it is already running.
 *
 * Not every store can. Asking rather than trying is what keeps the driver from taking a connection
 * of its own for a store that would have nothing to do with one - which is a cost paid per
 * operation, against a capability that would never be used.
 */
export type StatementCancellingDataSource = {
    /**
     * Stops whatever statement the given connection is running.
     *
     * Called when the request a statement was issued for has been answered without it. The
     * connection is held until this has finished, so that a cancel cannot arrive after the
     * connection went back to the pool and stop somebody else's statement instead.
     */
    cancelStatementOn: (runner: QueryRunner) => Promise<void>
};

/**
 * Checks whether the given store can stop a statement it is already running.
 * @param value - The store to check.
 * @returns True when it can, which is also what narrows it to the shape that does.
 */
export function cancelsStatements(value: unknown): value is StatementCancellingDataSource {
    return typeof (value as StatementCancellingDataSource).cancelStatementOn === 'function';
}