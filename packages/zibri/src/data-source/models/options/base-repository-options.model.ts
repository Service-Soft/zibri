import { type Unscoped } from '../../../entity/models/entity-scope.model.ts';
import { Transaction } from '../../transaction/transaction.model.ts';

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
    acrossTenants?: boolean,
    /**
     * How long this call may take, in milliseconds, in place of the data source's own statement
     * timeout. 0 for no limit.
     *
     * Each statement of the call may take that long, and the call as a whole as well: once it has run
     * out of time, the statement still running is stopped where the store can stop one, and nothing
     * further is asked of the store. Inside a request the call still ends with the request.
     */
    timeoutInMs?: number
};