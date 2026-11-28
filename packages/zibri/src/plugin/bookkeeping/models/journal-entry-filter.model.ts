import { type JournalEntryQueryModel } from 'zibri-contract';

/**
 * What a page of the entries is narrowed by, as `GET /entries` takes it beside the page: the fiscal year, the days
 * from `from` to `until`, each of them optional, and the account an entry has a line on. Each left out narrows
 * nothing.
 */
export type JournalEntryFilter = Pick<JournalEntryQueryModel, 'fiscalYearId' | 'from' | 'until' | 'accountId'>;
