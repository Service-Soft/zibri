import { DefinedPermissions, definePermissions } from './define-permissions.function';

/**
 * The tenant permissions the bank plugin of Zibri checks, in the tenant a request acts in: adding the bank accounts of
 * that tenant, importing their statements, reading the accounts, statements and transactions, and reading, suggesting
 * and confirming the matches of transactions with invoices. Spread them into the tenant permissions of the
 * application.
 */
// eslint-disable-next-line typescript/typedef
export const ZIBRI_BANK_PERMISSIONS = [
    'bank.accounts.manage',
    'bank.statements.import',
    'bank.transactions.read',
    'bank.matches.read',
    'bank.matches.suggest',
    'bank.matches.confirm'
] as const;

/**
 * {@link ZIBRI_BANK_PERMISSIONS}, by name.
 */
export const ZibriBankPermissions: DefinedPermissions<typeof ZIBRI_BANK_PERMISSIONS> = definePermissions(ZIBRI_BANK_PERMISSIONS);