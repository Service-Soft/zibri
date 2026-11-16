import { Readable } from 'node:stream';
import { StringDecoder } from 'node:string_decoder';

import { PostgresChangeLine, PostgresChangeRow } from './postgres-change-line.model';
import { PostgresSqlUtilities } from './postgres-sql.utilities';
import { InternalError } from '../../../error-handling/internal-error.model';
import { JsonUtilities } from '../../../utilities/json.utilities';
import { literalToSql } from '../../literal-to-sql.function';

/**
 * The shape of the lines {@link PostgresChangeSqlUtilities} reads.
 */
export const POSTGRES_CHANGE_FORMAT_VERSION: number = 1;

/**
 * Writes what a backup that read only what changed holds as the statements that apply it.
 */
export abstract class PostgresChangeSqlUtilities {
    /**
     * Writes the changes of backups as the statements that apply them, one backup after another.
     * @param increments - What each backup holds, the oldest first.
     * @param schema - The schema the tables and sequences are in.
     * @yields The statements.
     * @throws When a backup holds a line that is not one.
     */
    static async* resolveScript(increments: Readable[], schema: string): AsyncGenerator<string> {
        if (!increments.length) {
            return;
        }
        yield this.resolvePreamble();
        for (const increment of increments) {
            for await (const line of this.readLines(increment)) {
                yield this.resolveStatement(line, schema);
            }
        }
        yield this.resolveEpilogue();
    }

    /**
     * Reads whether what a backup holds changes a table: a row of it written, or the table cleared.
     * @param increment - What the backup holds.
     * @param table - The table, without its schema.
     * @returns Whether it does.
     * @throws When the backup holds a line that is not one.
     */
    static async resolveTouchesTable(increment: Readable, table: string): Promise<boolean> {
        for await (const line of this.readLines(increment)) {
            if (this.getTables(line).includes(table)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Writes one line of changes as JSON.
     * @param line - The line.
     * @returns The line, with its line break.
     */
    static resolveLine(line: PostgresChangeLine): string {
        // a value holding a line break is written as two characters by JSON, so a line is one change
        return `${JsonUtilities.stringify(line)}\n`;
    }

    /**
     * What runs before the statements of the changes: each change is applied as it was made, so that
     * neither a trigger nor a foreign key's action runs for it again, whose effects are changes of their
     * own among the others. Postgres's own logical replication applies changes the same way. The
     * statements are read as UTF-8, with a backslash in a string being just that, as they are written.
     * @returns The statements.
     */
    static resolvePreamble(): string {
        // the changes are applied in the session of the dump's script, after it, which sets the encoding
        // of the database it was taken of and the standard_conforming_strings of that server. The values
        // here are written as UTF-8, and quoted only by doubling a quote
        return 'SET LOCAL client_encoding = \'UTF8\';\n'
            + 'SET LOCAL standard_conforming_strings = on;\n'
            + 'SET LOCAL session_replication_role = replica;\n';
    }

    /**
     * What runs after the statements of the changes, inside the same transaction.
     * @returns The statement.
     */
    static resolveEpilogue(): string {
        return 'SET LOCAL session_replication_role = origin;\n';
    }

    /**
     * Writes one line as a statement.
     * @param line - The line.
     * @param schema - The schema the tables and sequences are in.
     * @returns The statement, or nothing for the header.
     * @throws When the header names a shape this build does not read.
     */
    static resolveStatement(line: PostgresChangeLine, schema: string): string {
        const escapedSchema: string = PostgresSqlUtilities.escapeIdentifier(schema);
        const table: (name: string) => string = name => `${escapedSchema}.${PostgresSqlUtilities.escapeIdentifier(name)}`;
        switch (line.kind) {
            case 'header': {
                if (line.formatVersion !== POSTGRES_CHANGE_FORMAT_VERSION) {
                    throw new InternalError(
                        `The changes of the backup are written in shape ${line.formatVersion}, `
                        + `and this build reads ${POSTGRES_CHANGE_FORMAT_VERSION}.`
                    );
                }
                return '';
            }
            case 'insert': {
                return `INSERT INTO ${table(line.table)} (${this.resolveColumns(line.row.columns)}) OVERRIDING SYSTEM VALUE`
                    + ` VALUES (${this.resolveValues(line.row.values)});\n`;
            }
            case 'update': {
                // an update sending no column but the ones left unchanged changes nothing
                if (!line.row.columns.length) {
                    return '';
                }
                const set: string = line.row.columns
                    .map((column, i) => `${PostgresSqlUtilities.escapeIdentifier(column)} = ${literalToSql(line.row.values[i] ?? null)}`)
                    .join(', ');
                return `UPDATE ${table(line.table)} SET ${set} WHERE ${this.resolveKey(line.key)};\n`;
            }
            case 'delete': {
                return `DELETE FROM ${table(line.table)} WHERE ${this.resolveKey(line.key)};\n`;
            }
            case 'truncate': {
                return `TRUNCATE ${line.tables.map(t => table(t)).join(', ')}`
                    + `${line.restartIdentity ? ' RESTART IDENTITY' : ''}${line.cascade ? ' CASCADE' : ''};\n`;
            }
            case 'clear': {
                return `DELETE FROM ${table(line.table)};\n`;
            }
            case 'rows': {
                const rows: string = line.values.map(values => `(${this.resolveValues(values)})`).join(', ');
                return !line.values.length
                    ? ''
                    : `INSERT INTO ${table(line.table)} (${this.resolveColumns(line.columns)}) OVERRIDING SYSTEM VALUE VALUES `
                        + `${rows};\n`;
            }
            case 'sequence': {
                return `SELECT pg_catalog.setval(${literalToSql(table(line.sequence))}, ${literalToSql(line.lastValue)}::bigint, `
                    + `${line.isCalled ? 'true' : 'false'});\n`;
            }
        }
    }

    private static async* readLines(data: Readable): AsyncGenerator<PostgresChangeLine> {
        const decoder: StringDecoder = new StringDecoder('utf8');
        let rest: string = '';
        for await (const piece of data) {
            rest += typeof piece === 'string' ? piece : decoder.write(Buffer.isBuffer(piece) ? piece : Buffer.from(String(piece)));
            const lines: string[] = rest.split('\n');
            rest = lines.pop() ?? '';
            for (const line of lines.filter(l => l.length)) {
                yield JsonUtilities.parse<PostgresChangeLine>(line);
            }
        }
        rest += decoder.end();
        if (rest.length) {
            yield JsonUtilities.parse<PostgresChangeLine>(rest);
        }
    }

    private static getTables(line: PostgresChangeLine): string[] {
        switch (line.kind) {
            case 'header':
            case 'sequence': {
                return [];
            }
            case 'truncate': {
                return line.tables;
            }
            case 'insert':
            case 'update':
            case 'delete':
            case 'clear':
            case 'rows': {
                return [line.table];
            }
        }
    }

    private static resolveColumns(columns: string[]): string {
        return columns.map(c => PostgresSqlUtilities.escapeIdentifier(c)).join(', ');
    }

    private static resolveValues(values: (string | null)[]): string {
        // as text, which postgres reads as the type of the column it goes into
        return values.map(v => literalToSql(v)).join(', ');
    }

    private static resolveKey(key: PostgresChangeRow): string {
        // a replica identity is a primary key or a unique index over columns that are not null
        return key.columns
            .map((column, i) => `${PostgresSqlUtilities.escapeIdentifier(column)} = ${literalToSql(key.values[i] ?? null)}`)
            .join(' AND ');
    }
}