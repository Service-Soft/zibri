import { type BookkeepingPluginOptions } from './bookkeeping-plugin-options.model';
import { type TenantsWithoutBooksOptions } from './tenants-without-books.type';

/**
 * Input for configuring the bookkeeping plugin: what happens in a tenant without bookkeeping settings, which is
 * required, with `resolveSettingsOf` for `never`, the retention of the journal, unless 10 years, the file store of the
 * receipts of expenses, unless `receipts`, and their retention, unless 8 years.
 */
export type BookkeepingPluginOptionsInput = TenantsWithoutBooksOptions
    & Partial<Omit<BookkeepingPluginOptions, keyof TenantsWithoutBooksOptions>>;