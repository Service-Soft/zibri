import { type ChartOfAccounts } from '../../models/chart-of-accounts.model';
import { ChartOfAccountsUtilities } from '../chart-of-accounts.utilities';
import { SKR04_CLASS_0_ACCOUNTS } from './skr04-class-0-accounts.model';
import { SKR04_CLASS_1_ACCOUNTS } from './skr04-class-1-accounts.model';
import { SKR04_CLASS_2_ACCOUNTS } from './skr04-class-2-accounts.model';
import { SKR04_CLASS_3_ACCOUNTS } from './skr04-class-3-accounts.model';
import { SKR04_CLASS_4_ACCOUNTS } from './skr04-class-4-accounts.model';
import { SKR04_CLASS_5_ACCOUNTS } from './skr04-class-5-accounts.model';
import { SKR04_CLASS_6_ACCOUNTS } from './skr04-class-6-accounts.model';
import { SKR04_CLASS_7_ACCOUNTS } from './skr04-class-7-accounts.model';
import { SKR04_CLASS_9_ACCOUNTS } from './skr04-class-9-accounts.model';

/**
 * The SKR 04, the standard chart ordered by the statements (Abschlussgliederungsprinzip), as valid for 2026: class 0
 * the fixed assets, 1 the current assets, 2 the equity, 3 the provisions and liabilities, 4 the operating income, 5
 * and 6 the operating expenses, 7 the financial result, the taxes and the appropriation of the result, and 9 the
 * carry-forward and statistical accounts. Each account is mapped to the position of the full HGB statements it is
 * reported in. Nothing is seeded: spread `accounts` into the accounts of a tenant.
 */
// the numbers, types and positions are facts of the frame; the names are written for it from what each account
// holds, and none is taken from the texts of the frame's publisher
export const skr04ChartOfAccounts: ChartOfAccounts = {
    id: 'skr04',
    name: 'SKR 04',
    accounts: ChartOfAccountsUtilities.resolveAccounts([
        ...SKR04_CLASS_0_ACCOUNTS,
        ...SKR04_CLASS_1_ACCOUNTS,
        ...SKR04_CLASS_2_ACCOUNTS,
        ...SKR04_CLASS_3_ACCOUNTS,
        ...SKR04_CLASS_4_ACCOUNTS,
        ...SKR04_CLASS_5_ACCOUNTS,
        ...SKR04_CLASS_6_ACCOUNTS,
        ...SKR04_CLASS_7_ACCOUNTS,
        ...SKR04_CLASS_9_ACCOUNTS
    ])
};