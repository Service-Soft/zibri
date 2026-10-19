import { QueryRunner } from 'typeorm';

/**
 * The key under which a connection's `data` holds the limit its transaction was begun under.
 *
 * Read so that an operation inside that transaction, under that same limit, does not set it again.
 */
export const OPERATION_LIMIT_DATA_KEY: string = 'zibriOperationLimit';

/**
 * A store whose statements have a time limit that can be changed for the work running on one
 * connection.
 */
export type StatementLimitingDataSource = {
    /**
     * Gives the statements on the given connection the given time limit, until the returned function
     * puts back the one they had.
     *
     * Inside a transaction the limit holds for the transaction at most, so a connection that goes back
     * to the pool afterwards never carries it to somebody else's statements.
     */
    limitStatementsOn: (runner: QueryRunner, timeoutInMs: number, inTransaction: boolean) => Promise<() => Promise<void>>
};

/**
 * Checks whether the given store can change the time limit of its statements.
 * @param value - The store to check.
 * @returns True when it can, which is also what narrows it to the shape that does.
 */
export function limitsStatements(value: unknown): value is StatementLimitingDataSource {
    return typeof (value as StatementLimitingDataSource).limitStatementsOn === 'function';
}