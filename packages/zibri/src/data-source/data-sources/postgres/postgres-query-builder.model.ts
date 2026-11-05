import { PostgresSchema } from './postgres-schema.model';
import { PostgresSqlUtilities } from './postgres-sql.utilities';
import { BaseEntity } from '../../../entity/base-entity.model';
import { Newable } from '../../../types/newable.type';
import { Transaction } from '../../transaction/transaction.model';
import { QueryBuilder, QueryOrder } from '../sql-data-source.interface';
import { ParameterizedSql } from '../where-converter/parameterized-sql.model';

/**
 * Runs one statement of a postgres data source.
 */
type RunStatement = (statement: ParameterizedSql, transaction: Transaction | undefined) => Promise<Record<string, unknown>[]>;

/**
 * A query on the table of an entity of a postgres data source, written a clause at a time.
 */
export class PostgresQueryBuilder implements QueryBuilder {

    private selections: string[] = [];

    private readonly joins: string[] = [];

    private condition: string | undefined;

    private groups: string[] = [];

    private groupCondition: string | undefined;

    private orders: string[] = [];

    private window: string = '';

    private readonly parameters: Record<string, unknown> = {};

    /**
     * The entity each alias reads, which says what column an `alias.property` is.
     */
    private readonly aliases: Map<string, Newable<BaseEntity>> = new Map();

    /**
     * Starts a query on the table of an entity.
     * @param entityClass - The entity.
     * @param alias - The alias its rows are read under.
     * @param schema - The tables of the data source.
     * @param transaction - The transaction to run in.
     * @param run - Runs the statement.
     */
    constructor(
        private readonly entityClass: Newable<BaseEntity>,
        private readonly alias: string,
        private readonly schema: PostgresSchema,
        private readonly transaction: Transaction | undefined,
        private readonly run: RunStatement
    ) {
        this.aliases.set(alias, entityClass);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    select(selection: string, alias?: string): this {
        this.selections = [];
        return this.addSelect(selection, alias);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    addSelect(selection: string, alias?: string): this {
        const expression: string = this.resolveProperties(selection);
        this.selections.push(alias == undefined ? expression : `${expression} AS ${PostgresSqlUtilities.escapeIdentifier(alias)}`);
        return this;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    leftJoin(entityClass: Newable<BaseEntity>, alias: string, condition: string, parameters?: Record<string, unknown>): this {
        return this.join('LEFT JOIN', entityClass, alias, condition, parameters);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    innerJoin(entityClass: Newable<BaseEntity>, alias: string, condition: string, parameters?: Record<string, unknown>): this {
        return this.join('JOIN', entityClass, alias, condition, parameters);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    where(condition: string, parameters?: Record<string, unknown>): this {
        this.condition = `(${this.resolveProperties(condition)})`;
        return this.setParameters(parameters ?? {});
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    andWhere(condition: string, parameters?: Record<string, unknown>): this {
        const added: string = `(${this.resolveProperties(condition)})`;
        this.condition = this.condition == undefined ? added : `${this.condition} AND ${added}`;
        return this.setParameters(parameters ?? {});
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    orWhere(condition: string, parameters?: Record<string, unknown>): this {
        const added: string = `(${this.resolveProperties(condition)})`;
        this.condition = this.condition == undefined ? added : `(${this.condition} OR ${added})`;
        return this.setParameters(parameters ?? {});
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    groupBy(expression: string): this {
        this.groups = [];
        return this.addGroupBy(expression);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    addGroupBy(expression: string): this {
        this.groups.push(this.resolveProperties(expression));
        return this;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    having(condition: string, parameters?: Record<string, unknown>): this {
        this.groupCondition = this.resolveProperties(condition);
        return this.setParameters(parameters ?? {});
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    orderBy(expression: string, order: QueryOrder = 'ASC'): this {
        this.orders = [];
        return this.addOrderBy(expression, order);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    addOrderBy(expression: string, order: QueryOrder = 'ASC'): this {
        this.orders.push(`${this.resolveProperties(expression)} ${order === 'DESC' ? 'DESC' : 'ASC'}`);
        return this;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    limit(limit: number): this {
        this.window = `${this.window.replace(/ LIMIT \d+/, '')} LIMIT ${Math.trunc(Number(limit))}`;
        return this;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    offset(offset: number): this {
        this.window = `${this.window.replace(/ OFFSET \d+/, '')} OFFSET ${Math.trunc(Number(offset))}`;
        return this;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    setParameters(parameters: Record<string, unknown>): this {
        Object.assign(this.parameters, parameters);
        return this;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async getRawMany<R>(): Promise<R[]> {
        const table: string = this.schema.getTable(this.entityClass).name;
        const selection: string = this.selections.length
            ? this.selections.join(', ')
            : `${PostgresSqlUtilities.escapeIdentifier(this.alias)}.*`;
        const sql: string = [
            `SELECT ${selection}`,
            `FROM ${PostgresSqlUtilities.escapeIdentifier(table)} ${PostgresSqlUtilities.escapeIdentifier(this.alias)}`,
            ...this.joins,
            ...this.condition == undefined ? [] : [`WHERE ${this.condition}`],
            ...this.groups.length ? [`GROUP BY ${this.groups.join(', ')}`] : [],
            ...this.groupCondition == undefined ? [] : [`HAVING ${this.groupCondition}`],
            ...this.orders.length ? [`ORDER BY ${this.orders.join(', ')}`] : []
        ].join(' ') + this.window;
        const rows: Record<string, unknown>[] = await this.run({ sql, parameters: this.parameters }, this.transaction);
        // the rows as the database answers them, which is what a query written by hand asks for
        return rows as R[];
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async getRawOne<R>(): Promise<R | undefined> {
        return (await this.limit(1).getRawMany<R>()).at(0);
    }

    private join(
        kind: string,
        entityClass: Newable<BaseEntity>,
        alias: string,
        condition: string,
        parameters?: Record<string, unknown>
    ): this {
        this.aliases.set(alias, entityClass);
        const table: string = this.schema.getTable(entityClass).name;
        this.joins.push(
            `${kind} ${PostgresSqlUtilities.escapeIdentifier(table)} ${PostgresSqlUtilities.escapeIdentifier(alias)}`
            + ` ON ${this.resolveProperties(condition)}`
        );
        return this.setParameters(parameters ?? {});
    }

    /**
     * Writes every `alias.property` of an expression as the column the property is stored in.
     * @param expression - The expression.
     * @returns It, with the columns quoted.
     */
    private resolveProperties(expression: string): string {
        return expression.replaceAll(/(?<![\w".])([A-Z_a-z]\w*)\.([A-Z_a-z]\w*)/g, (written, alias: string, property: string) => {
            const entityClass: Newable<BaseEntity> | undefined = this.aliases.get(alias);
            if (entityClass == undefined) {
                return written;
            }
            const column: string = this.schema.getTable(entityClass).columns
                .find(c => c.property === property || c.name === property)?.name ?? property;
            return PostgresSqlUtilities.qualify(alias, column);
        });
    }
}