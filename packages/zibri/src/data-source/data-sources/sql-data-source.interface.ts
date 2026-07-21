import { QueryBuilder as ToQueryBuilder } from 'typeorm';

import { DataSourceInterface } from './data-source.interface';
import { BaseEntity } from '../../entity/base-entity.model';
import { Newable } from '../../types/newable.type';
import { Transaction } from '../transaction/transaction.model';

/**
 * Definition of a sql query builder.
 */
export type QueryBuilder<T extends BaseEntity> = ToQueryBuilder<T>;

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
    query: <T extends BaseEntity>(entityClass: Newable<T>, options?: QueryOptions) => QueryBuilder<T>
}