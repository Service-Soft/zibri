import { describe, expect, it } from '@jest/globals';

import { PostgresStatementErrorUtilities } from './postgres-statement-error.utilities';

/**
 * An error of the driver with the sql state postgres answered.
 * @param code - The sql state.
 * @param message - The message.
 * @returns The error.
 */
function withCode(code: string, message: string): Error {
    return Object.assign(new Error(message), { code });
}

// which failures a statement runs again on another connection for: only those that say it committed nothing,
// since one that may have committed would run twice
describe('PostgresStatementErrorUtilities - a connection ended before its statement committed', () => {
    it.each([
        ['terminated by an administrator', withCode('57P01', 'terminating connection due to administrator command')],
        ['ended by a crash of another process', withCode('57P02', 'terminating connection because of crash of another server process')],
        ['refused while the server starts', withCode('57P03', 'the database system is starting up')],
        ['failed before the statement was sent', new Error('Client has encountered a connection error and is not queryable')],
        ['wrapped in another error', new Error('the statement failed', { cause: withCode('57P01', 'terminating connection due to administrator command') })]
    ])('runs again on another connection when the connection was %s', (_, error) => {
        expect(PostgresStatementErrorUtilities.isEndedBeforeCommit(error)).toBe(true);
    });

    it.each([
        ['ended without saying why, after which the statement may have committed', new Error('Connection terminated unexpectedly')],
        ['refused to log in', withCode('28000', 'role "app" is not permitted to log in')],
        ['given a statement that broke a unique', withCode('23505', 'duplicate key value violates unique constraint')],
        ['something that is no error', 'terminating connection due to administrator command']
    ])('runs nothing again when the connection was %s', (_, error) => {
        expect(PostgresStatementErrorUtilities.isEndedBeforeCommit(error)).toBe(false);
    });
});