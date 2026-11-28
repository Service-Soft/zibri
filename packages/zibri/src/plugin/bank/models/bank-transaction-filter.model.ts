import { type BankTransactionQueryModel } from 'zibri-contract';

/**
 * Which transactions `findTransactionDetails` answers: of an account, of the statement they were first imported with,
 * booked on the days `from` to `until`, and `OPEN` or `MATCHED`. Every transaction of the active tenant by default.
 */
// the query of GET /transactions without its page, so that the route and the service take the same filter
export type BankTransactionFilter = Omit<BankTransactionQueryModel, 'page' | 'limit'>;