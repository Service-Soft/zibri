import { BankPluginOptions } from './bank-plugin-options.model';

/**
 * Input for configuring the bank plugin: the file store of the original files, unless `bank-statements`, the
 * retention of the statements, unless 8 years, and the matching of transactions with invoices, unless none.
 */
export type BankPluginOptionsInput = Partial<BankPluginOptions>;