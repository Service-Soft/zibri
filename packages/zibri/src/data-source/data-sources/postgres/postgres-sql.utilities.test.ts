import { describe, expect, it } from '@jest/globals';

import { PostgresSqlUtilities } from './postgres-sql.utilities';

// a warning naming what a connection runs reads it from the server, which holds the statement as it was sent:
// one somebody wrote with a value in it would put that value into the log
describe('PostgresSqlUtilities.toLoggedStatement', () => {
    it('replaces every string by the same five asterisks, however long it is, and keeps the rest', () => {
        expect(PostgresSqlUtilities.toLoggedStatement(
            'UPDATE "user" SET email = \'ada@example.com\', note = \'it\'\'s\', initial = \'a\' WHERE id = $1 AND age > 30'
        )).toBe('UPDATE "user" SET email = \'*****\', note = \'*****\', initial = \'*****\' WHERE id = $1 AND age > 30');
        expect(PostgresSqlUtilities.toLoggedStatement('ALTER ROLE app PASSWORD \'hunter2\'')).toBe('ALTER ROLE app PASSWORD \'*****\'');
    });

    it('reads a backslash as an escape in a string that says so, and as itself in any other', () => {
        expect(PostgresSqlUtilities.toLoggedStatement('SELECT E\'pass\\\'word\', \'next\'')).toBe('SELECT \'*****\', \'*****\'');
        expect(PostgresSqlUtilities.toLoggedStatement('SELECT \'C:\\\', \'secret\' WHERE name LIKE\'a\\\'')).toBe(
            'SELECT \'*****\', \'*****\' WHERE name LIKE\'*****\''
        );
    });

    it('replaces a string quoted with dollars, up to the tag it started with', () => {
        expect(PostgresSqlUtilities.toLoggedStatement('SELECT $$it\'s secret$$, $tag$ a $$ b $tag$, $1, $2')).toBe(
            'SELECT \'*****\', \'*****\', $1, $2'
        );
    });

    it('replaces a string the server cut short, to its end', () => {
        expect(PostgresSqlUtilities.toLoggedStatement('INSERT INTO task VALUES (\'the first half of a tit')).toBe(
            'INSERT INTO task VALUES (\'*****\''
        );
        expect(PostgresSqlUtilities.toLoggedStatement('DO $body$ BEGIN PERFORM set_config(\'a\', \'half a sec')).toBe('DO \'*****\'');
    });

    it('takes a quote inside a name or a comment for no string', () => {
        expect(PostgresSqlUtilities.toLoggedStatement('SELECT "it\'s" FROM task WHERE title = \'secret\'')).toBe(
            'SELECT "it\'s" FROM task WHERE title = \'*****\''
        );
        expect(PostgresSqlUtilities.toLoggedStatement('SELECT 1 -- it\'s one\n, \'secret\' /* isn\'t */, \'other\'')).toBe(
            'SELECT 1 -- it\'s one\n, \'*****\' /* isn\'t */, \'*****\''
        );
    });

    it('cuts a long statement short after its strings were replaced', () => {
        const columns: string = Array.from({ length: 60 }, (_, i) => `column_${i}`).join(', ');
        const logged: string = PostgresSqlUtilities.toLoggedStatement(`SELECT ${columns} FROM task WHERE title = 'secret'`);

        expect(logged).toHaveLength(200);
        expect(logged.startsWith('SELECT column_0, column_1, ')).toBe(true);
        expect(PostgresSqlUtilities.toLoggedStatement(`SELECT '${'secret '.repeat(100)}' FROM task`)).toBe('SELECT \'*****\' FROM task');
    });
});