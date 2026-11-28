import { type ExpenseQueryModel } from 'zibri-contract';

/**
 * Which expenses `findExpenses` answers: those whose document number or supplier a `search` finds. Every expense of
 * the active tenant by default.
 */
// the query of GET /expenses without its page and tenant, so that the route and the service take the same filter
export type ExpenseFilter = Omit<ExpenseQueryModel, 'page' | 'limit' | 'tenantId'>;
