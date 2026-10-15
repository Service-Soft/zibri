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
    unscoped?: Unscoped,
    /**
     * Whether this call reaches the rows of every tenant rather than those of the active one.
     *
     * Separate from `unscoped` on purpose: lifting an entity's scopes never reaches another tenant's
     * rows. Needed by work that serves every tenant at once - a job draining a queue, a platform
     * report - and by code outside any tenant writing a tenant's row, which then names the tenant in
     * the data. A row's tenant cannot be changed either way.
     */
    acrossTenants?: boolean
};