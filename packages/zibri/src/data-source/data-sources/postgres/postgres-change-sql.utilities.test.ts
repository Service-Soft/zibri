import { Readable } from 'node:stream';

import { describe, expect, it } from '@jest/globals';

import { PostgresChangeLine } from './postgres-change-line.model';
import { POSTGRES_CHANGE_FORMAT_VERSION, PostgresChangeSqlUtilities } from './postgres-change-sql.utilities';

const HEADER: PostgresChangeLine = { kind: 'header', formatVersion: POSTGRES_CHANGE_FORMAT_VERSION };

/**
 * What a backup holding the given lines writes, as a stream cut into pieces that end inside a line.
 * @param lines - The lines.
 * @returns The stream.
 */
function toIncrement(lines: PostgresChangeLine[]): Readable {
    const written: Buffer = Buffer.from(lines.map(l => PostgresChangeSqlUtilities.resolveLine(l)).join(''));
    const pieces: Buffer[] = [];
    for (let i: number = 0; i < written.length; i += 7) {
        pieces.push(written.subarray(i, i + 7));
    }
    return Readable.from(pieces);
}

async function resolveScript(increments: Readable[]): Promise<string> {
    let script: string = '';
    for await (const statement of PostgresChangeSqlUtilities.resolveScript(increments, 'app')) {
        script += statement;
    }
    return script;
}

describe('PostgresChangeSqlUtilities', () => {
    it('writes each change as the statement that makes it, under the replica role, one backup after another', async () => {
        const script: string = await resolveScript([
            toIncrement([
                HEADER,
                { kind: 'insert', table: 'note', row: { columns: ['id', 'text'], values: ['1', 'it\'s ünïcode\nacross lines'] } },
                { kind: 'update', table: 'note', key: { columns: ['id'], values: ['1'] }, row: { columns: ['text'], values: [null] } }
            ]),
            toIncrement([
                HEADER,
                { kind: 'delete', table: 'note', key: { columns: ['id'], values: ['1'] } },
                { kind: 'truncate', tables: ['note', 'tag'], cascade: true, restartIdentity: false },
                { kind: 'clear', table: 'log' },
                { kind: 'rows', table: 'log', columns: ['at'], values: [['2026-11-12'], [null]] },
                { kind: 'sequence', sequence: 'log_id_seq', lastValue: '42', isCalled: true }
            ])
        ]);

        expect(script).toBe([
            'SET LOCAL client_encoding = \'UTF8\';',
            'SET LOCAL standard_conforming_strings = on;',
            'SET LOCAL session_replication_role = replica;',
            'INSERT INTO "app"."note" ("id", "text") OVERRIDING SYSTEM VALUE VALUES (\'1\', \'it\'\'s ünïcode\nacross lines\');',
            'UPDATE "app"."note" SET "text" = NULL WHERE "id" = \'1\';',
            'DELETE FROM "app"."note" WHERE "id" = \'1\';',
            'TRUNCATE "app"."note", "app"."tag" CASCADE;',
            'DELETE FROM "app"."log";',
            'INSERT INTO "app"."log" ("at") OVERRIDING SYSTEM VALUE VALUES (\'2026-11-12\'), (NULL);',
            'SELECT pg_catalog.setval(\'"app"."log_id_seq"\', \'42\'::bigint, true);',
            'SET LOCAL session_replication_role = origin;',
            ''
        ].join('\n'));
    });

    it('writes nothing for an update sending only unchanged values, and nothing at all without backups', async () => {
        expect(await resolveScript([toIncrement([HEADER, { kind: 'update', table: 'note', key: { columns: ['id'], values: ['1'] }, row: { columns: [], values: [] } }])])).toBe('SET LOCAL client_encoding = \'UTF8\';\nSET LOCAL standard_conforming_strings = on;\n'
            + 'SET LOCAL session_replication_role = replica;\nSET LOCAL session_replication_role = origin;\n');
        expect(await resolveScript([])).toBe('');
    });

    it('tells whether a backup changes a table, by a row of it or the table cleared', async () => {
        const touching: PostgresChangeLine[][] = [
            [{ kind: 'insert', table: 'migration', row: { columns: ['name'], values: ['m'] } }],
            [{ kind: 'update', table: 'migration', key: { columns: ['id'], values: ['1'] }, row: { columns: ['name'], values: ['m'] } }],
            [{ kind: 'delete', table: 'migration', key: { columns: ['id'], values: ['1'] } }],
            [{ kind: 'truncate', tables: ['note', 'migration'], cascade: false, restartIdentity: false }],
            [{ kind: 'clear', table: 'migration' }],
            [{ kind: 'rows', table: 'migration', columns: ['name'], values: [['m']] }]
        ];
        for (const lines of touching) {
            expect(await PostgresChangeSqlUtilities.resolveTouchesTable(toIncrement([HEADER, ...lines]), 'migration')).toBe(true);
        }
        expect(await PostgresChangeSqlUtilities.resolveTouchesTable(toIncrement([
            HEADER,
            { kind: 'insert', table: 'note', row: { columns: ['text'], values: ['migration'] } },
            { kind: 'sequence', sequence: 'migration', lastValue: '1', isCalled: true }
        ]), 'migration')).toBe(false);
    });

    it('refuses changes written in a shape this build does not read', async () => {
        await expect(resolveScript([toIncrement([{ kind: 'header', formatVersion: POSTGRES_CHANGE_FORMAT_VERSION + 1 }])]))
            .rejects.toThrow('this build reads');
    });
});