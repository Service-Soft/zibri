import { type SpanningTransaction } from './spanning-transaction.model';
import { Transaction } from './transaction.model';
import { type BaseChainedEntity } from '../chain/base-chained-entity.model';
import { type BaseEntity } from '../../entity/base-entity.model';

/**
 * The transaction a repository of an entity takes: a transaction of its data source, or a spanning
 * one. A chained entity takes only the first, since a row of a chain cannot be restored.
 */
export type RepositoryTransaction<T extends BaseEntity = BaseEntity> = T extends BaseChainedEntity
    ? Transaction
    : Transaction | SpanningTransaction;
