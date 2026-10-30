import { BaseChainedEntity } from './base-chained-entity.model';
import { ChainVerification } from './chain-verification.model';
import { Newable } from '../../types/newable.type';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * Where a row stands in its chain.
 */
export type ChainLink = Pick<BaseChainedEntity, 'chainSequence' | 'chainHash'>;

/**
 * Keeps the chains of the entities declared with `chained: true`: links the rows written to them,
 * tells whether a chain still holds, and removes rows from the old end of a chain.
 */
export interface ChainServiceInterface {
    /**
     * Resolves the `chainSequence` and `chainHash` of rows about to be created, after the newest row
     * of each of their chains, in the order of the rows. The repository calls it while it writes them.
     */
    resolveLinks: (entityClass: Newable<BaseChainedEntity>, rows: object[], transaction: Transaction | undefined) => Promise<ChainLink[]>,
    /**
     * Resolves whether the chain of a tenant, or of the rows of no tenant, holds: every row as it was
     * written, in an unbroken run from the oldest row kept.
     */
    resolveChainVerification: (entityClass: Newable<BaseChainedEntity>, tenantId: string | undefined) => Promise<ChainVerification>,
    /**
     * Removes the rows the filter matches from the old end of each chain, up to the first row it does
     * not match, and records where each chain starts from then on. Resolves how many rows were removed.
     * The repository calls it from `prune`.
     *
     * The filter names neither the tenant nor `chainSequence`.
     */
    pruneChains: (entityClass: Newable<BaseChainedEntity>, where: Where<BaseChainedEntity>) => Promise<number>
}