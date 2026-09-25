import { type Unscoped } from '../../../entity/models/entity-scope.model';
import { Transaction } from '../../transaction/transaction.model';

/**
 * Base options that are shared by all repository methods.
 */
export type BaseRepositoryOptions = {
    /**
     * A transaction to use.
     */
    transaction?: Transaction,
    /**
     * Which of the entity's scopes this call is exempt from.
     *
     * `true` skips all of them, an array skips the named ones. Needed by anything that legitimately
     * reads or writes across the restriction - a cron job, a migration, an administrative endpoint
     * behind its own role check - because a scoped entity is otherwise unreachable without a logged
     * in user.
     *
     * Every use is a place the restriction does not hold, which is why it is spelled out at the call
     * rather than configured away somewhere.
     */
    unscoped?: Unscoped
};