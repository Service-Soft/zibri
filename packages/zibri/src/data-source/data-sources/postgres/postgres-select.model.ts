import { PostgresSqlUtilities } from './postgres-sql.utilities';
import { ParameterizedSql } from '../where-converter/parameterized-sql.model';

/**
 * A select statement, built a clause at a time.
 */
export class PostgresSelect {

    private readonly selections: string[] = [];

    private readonly joins: string[] = [];

    private readonly conditions: string[] = [];

    private readonly groups: string[] = [];

    private readonly orders: string[] = [];

    private readonly parameters: Record<string, unknown> = {};

    private windowSql: string = '';

    private lockSql: string = '';

    /**
     * Starts a select of the rows of a table.
     * @param table - The table.
     * @param alias - The alias its rows are read under.
     */
    constructor(private readonly table: string, readonly alias: string) {}

    /**
     * Whether the statement joins another table.
     * @returns True once something was joined.
     */
    get joinsRows(): boolean {
        return this.joins.length > 0;
    }

    /**
     * Adds what the statement selects.
     * @param selections - The expressions, each with the name it is selected as when it has one.
     * @returns The statement.
     */
    select(...selections: (string | ParameterizedSql)[]): this {
        this.selections.push(...selections.map(s => this.take(s)));
        return this;
    }

    /**
     * Joins the rows of another table that a condition pairs with each row.
     * @param table - The table.
     * @param alias - The alias its rows are read under.
     * @param on - The condition.
     * @returns The statement.
     */
    leftJoin(table: string, alias: string, on: string | ParameterizedSql): this {
        const joined: string = `LEFT JOIN ${PostgresSqlUtilities.escapeIdentifier(table)} ${PostgresSqlUtilities.escapeIdentifier(alias)}`;
        this.joins.push(`${joined} ON ${this.take(on)}`);
        return this;
    }

    /**
     * Adds a condition every row has to meet.
     * @param condition - The condition.
     * @returns The statement.
     */
    where(condition: string | ParameterizedSql): this {
        this.conditions.push(`(${this.take(condition)})`);
        return this;
    }

    /**
     * Adds what the rows are grouped by.
     * @param expressions - The expressions.
     * @returns The statement.
     */
    groupBy(...expressions: string[]): this {
        this.groups.push(...expressions);
        return this;
    }

    /**
     * Adds what the rows are ordered by.
     * @param expressions - The expressions, each with its direction.
     * @returns The statement.
     */
    orderBy(...expressions: (string | ParameterizedSql)[]): this {
        this.orders.push(...expressions.map(e => this.take(e)));
        return this;
    }

    /**
     * Narrows the rows to a window.
     * @param offset - How many rows are passed over first.
     * @param limit - How many are read at most.
     * @returns The statement.
     */
    window(offset: number | undefined, limit: number | undefined): this {
        // numbers by their type, which nothing a caller writes can turn into sql
        const limitSql: string = limit == undefined ? '' : ` LIMIT ${Number(limit)}`;
        const offsetSql: string = offset == undefined ? '' : ` OFFSET ${Number(offset)}`;
        this.windowSql = `${limitSql}${offsetSql}`;
        return this;
    }

    /**
     * Holds the rows read under the statement's alias until the transaction ends.
     * @returns The statement.
     */
    lockRows(): this {
        this.lockSql = ` FOR UPDATE OF ${PostgresSqlUtilities.escapeIdentifier(this.alias)}`;
        return this;
    }

    /**
     * Writes the statement.
     * @returns The sql, and what it binds.
     */
    build(): ParameterizedSql {
        const parts: string[] = [
            `SELECT ${this.selections.length ? this.selections.join(', ') : '*'}`,
            `FROM ${PostgresSqlUtilities.escapeIdentifier(this.table)} ${PostgresSqlUtilities.escapeIdentifier(this.alias)}`,
            ...this.joins,
            ...this.conditions.length ? [`WHERE ${this.conditions.join(' AND ')}`] : [],
            ...this.groups.length ? [`GROUP BY ${this.groups.join(', ')}`] : [],
            ...this.orders.length ? [`ORDER BY ${this.orders.join(', ')}`] : []
        ];
        return { sql: `${parts.join(' ')}${this.windowSql}${this.lockSql}`, parameters: { ...this.parameters } };
    }

    /**
     * Takes the values of a piece of sql over into the statement.
     * @param part - The piece.
     * @returns Its sql.
     */
    private take(part: string | ParameterizedSql): string {
        if (typeof part === 'string') {
            return part;
        }
        Object.assign(this.parameters, part.parameters);
        return part.sql;
    }
}