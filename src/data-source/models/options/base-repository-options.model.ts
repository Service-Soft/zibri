import { Transaction } from '../../transaction';

/**
 * Base options that are shared by all repository methods.
 */
export type BaseRepositoryOptions = {
    /**
     * A transaction to use.
     */
    transaction?: Transaction
};