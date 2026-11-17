import { ParameterizedSql } from '../where-converter/parameterized-sql.model';

/**
 * A statement as the driver sends it: positional placeholders, and the values in their order.
 */
export type PostgresStatement = {
    /**
     * The sql, with a `$1` style placeholder for every value.
     */
    sql: string,
    /**
     * The values, in the order of their placeholders.
     */
    values: unknown[]
};

/**
 * A `:name` placeholder, which a cast such as `::jsonb` is not.
 */
const NAMED_PLACEHOLDER_PATTERN: RegExp = /(?<!:):([A-Z_a-z]\w*)/g;

/**
 * What a quote may be part of in a statement: a quoted name, a comment, a string whose backslashes escape,
 * any other string, and a string quoted with dollars. A string runs to the end of a statement that was cut
 * short inside it.
 */
// the names and comments are matched to be skipped: a quote inside one would otherwise start a string, and
// every string after it would be taken for what lies between two strings
const QUOTED_PATTERN: RegExp = new RegExp(
    [
        /"(?:[^"]|"")*"/,
        /--[^\n]*/,
        /\/\*[\S\s]*?\*\//,
        /\b[Ee]'(?:[^'\\]|''|\\[\S\s])*(?:'|$)/,
        /'(?:[^']|'')*(?:'|$)/,
        /\$([A-Z_a-z]\w*|)\$[\S\s]*?(?:\$\1\$|$)/
    ].map(part => part.source).join('|'),
    'g'
);

/**
 * What a string of a statement is logged as, whatever it holds and however long it is.
 */
const LOGGED_STRING: string = '\'*****\'';

/**
 * How many characters of a statement are logged.
 */
const LOGGED_STATEMENT_LENGTH: number = 200;

/**
 * Builds the sql of the statements a postgres data source sends.
 */
export abstract class PostgresSqlUtilities {
    /**
     * A statement as a log names it: every string in it replaced by the same asterisks, so that a value somebody
     * wrote into one is not logged, and cut short. Numbers stay as they are.
     * @param sql - The statement, as the server holds it.
     * @returns What to log of it.
     */
    static toLoggedStatement(sql: string): string {
        return sql
            .replaceAll(QUOTED_PATTERN, quoted => quoted.startsWith('"') || quoted.startsWith('--') || quoted.startsWith('/*')
                ? quoted
                : LOGGED_STRING)
            .slice(0, LOGGED_STATEMENT_LENGTH);
    }

    /**
     * Quotes a name for a statement.
     * @param name - The name of a table, a column, an alias or a collation.
     * @returns The name, quoted.
     */
    static escapeIdentifier(name: string): string {
        return `"${name.replaceAll('"', '""')}"`;
    }

    /**
     * Names a column of the rows read under an alias.
     * @param alias - The alias.
     * @param column - The column.
     * @returns The qualified column.
     */
    static qualify(alias: string, column: string): string {
        return `${this.escapeIdentifier(alias)}.${this.escapeIdentifier(column)}`;
    }

    /**
     * Turns the named placeholders of a statement into the positional ones the driver binds.
     *
     * Only the names the statement has a value for, as typeorm did: a `:` inside a comment or a json
     * key bound as a value stays as it is.
     * @param statement - The statement with named placeholders.
     * @returns The statement with positional ones.
     */
    static toStatement(statement: ParameterizedSql): PostgresStatement {
        const values: unknown[] = [];
        const positions: Map<string, number> = new Map();
        const sql: string = statement.sql.replaceAll(NAMED_PLACEHOLDER_PATTERN, (placeholder, name: string) => {
            if (!Object.hasOwn(statement.parameters, name)) {
                return placeholder;
            }
            let position: number | undefined = positions.get(name);
            if (position == undefined) {
                values.push(statement.parameters[name]);
                position = values.length;
                positions.set(name, position);
            }
            return `$${position}`;
        });
        return { sql, values };
    }

    /**
     * Puts literals in place of the named placeholders of a statement, for a statement that takes no
     * parameters, such as the query a cursor is declared for.
     *
     * The same names as {@link toStatement} replaces, so that what is left as it is stays the same.
     * @param statement - The statement with named placeholders.
     * @param literals - The literal of each value, by its name, as the server quotes it.
     * @returns The sql.
     */
    static toInlinedSql(statement: ParameterizedSql, literals: Map<string, string>): string {
        return statement.sql.replaceAll(NAMED_PLACEHOLDER_PATTERN, (placeholder, name: string) => literals.get(name) ?? placeholder);
    }

    /**
     * Joins pieces of sql, and the values each binds.
     * @param parts - The pieces.
     * @param separator - What goes between two of them.
     * @returns The joined piece.
     */
    static join(parts: ParameterizedSql[], separator: string): ParameterizedSql {
        const parameters: Record<string, unknown> = {};
        for (const part of parts) {
            Object.assign(parameters, part.parameters);
        }
        return { sql: parts.map(p => p.sql).join(separator), parameters };
    }
}