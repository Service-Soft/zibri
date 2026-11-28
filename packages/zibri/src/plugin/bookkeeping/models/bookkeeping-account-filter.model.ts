import { type BookkeepingAccountQueryModel } from 'zibri-contract';

/**
 * Which accounts `findAccounts` answers: those a `search` finds by the start of their number or by their name, and
 * those `open` or closed. Every account of the books by default.
 */
// the query of GET /accounts without its tenant, so that the route and the service take the same filter
export type BookkeepingAccountFilter = Omit<BookkeepingAccountQueryModel, 'tenantId'>;