import { DataSourceInterface } from './data-source.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { Transaction } from '../transaction/transaction.model';

/**
 * The direction rows are ordered in.
 */
export type QueryOrder = 'ASC' | 'DESC';

/**
 * A query on the table of an entity, written a clause at a time.
 *
 * An expression names a property as `alias.property`, which is written as the column it is stored in,
 * and a value as `:name`, bound from the parameters given beside it.
 */
export interface QueryBuilder {
    /**
     * Sets what the query selects.
     */
    select: (selection: string, alias?: string) => this,
    /**
     * Adds to what the query selects.
     */
    addSelect: (selection: string, alias?: string) => this,
    /**
     * Joins the rows of another entity that a condition pairs with each row, or none.
     */
    leftJoin: (entityClass: Newable<BaseEntity>, alias: string, condition: string, parameters?: Record<string, unknown>) => this,
    /**
     * Joins the rows of another entity that a condition pairs with each row, leaving out a row with none.
     */
    innerJoin: (entityClass: Newable<BaseEntity>, alias: string, condition: string, parameters?: Record<string, unknown>) => this,
    /**
     * Sets the condition every row has to meet.
     */
    where: (condition: string, parameters?: Record<string, unknown>) => this,
    /**
     * Adds a condition every row has to meet as well.
     */
    andWhere: (condition: string, parameters?: Record<string, unknown>) => this,
    /**
     * Adds a condition a row may meet instead.
     */
    orWhere: (condition: string, parameters?: Record<string, unknown>) => this,
    /**
     * Sets what the rows are grouped by.
     */
    groupBy: (expression: string) => this,
    /**
     * Adds to what the rows are grouped by.
     */
    addGroupBy: (expression: string) => this,
    /**
     * Sets the condition every group has to meet.
     */
    having: (condition: string, parameters?: Record<string, unknown>) => this,
    /**
     * Sets what the rows are ordered by.
     */
    orderBy: (expression: string, order?: QueryOrder) => this,
    /**
     * Adds to what the rows are ordered by.
     */
    addOrderBy: (expression: string, order?: QueryOrder) => this,
    /**
     * Reads at most this many rows.
     */
    limit: (limit: number) => this,
    /**
     * Passes over this many rows first.
     */
    offset: (offset: number) => this,
    /**
     * Binds the values named in the query.
     */
    setParameters: (parameters: Record<string, unknown>) => this,
    /**
     * Runs the query.
     * @returns Every row, as the database answers it.
     */
    getRawMany: <R>() => Promise<R[]>,
    /**
     * Runs the query.
     * @returns The first row, as the database answers it, or undefined when there is none.
     */
    getRawOne: <R>() => Promise<R | undefined>
}

/**
 * Options for starting a sql query.
 */
export type QueryOptions = {
    /**
     * The transaction to run the query in.
     */
    transaction?: Transaction,
    /**
     * The alias of the entity in the queries. Defaults to the name of the entity.
     */
    alias?: string
};

/**
 * Definition for a sql data source.
 */
export interface SqlDataSourceInterface extends DataSourceInterface {
    /**
     * Starts a custom query builder on the table of the given entity.
     */
    query: <T extends BaseEntity>(entityClass: Newable<T>, options?: QueryOptions) => QueryBuilder
}