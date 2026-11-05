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
 * Builds the sql of the statements a postgres data source sends.
 */
export abstract class PostgresSqlUtilities {
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