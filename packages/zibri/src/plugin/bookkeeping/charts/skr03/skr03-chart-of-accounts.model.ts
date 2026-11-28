import { type ChartOfAccounts } from '../../models/chart-of-accounts.model';
import { ChartOfAccountsUtilities } from '../chart-of-accounts.utilities';
import { SKR03_CLASS_0_ACCOUNTS } from './skr03-class-0-accounts.model';
import { SKR03_CLASS_1_ACCOUNTS } from './skr03-class-1-accounts.model';
import { SKR03_CLASS_2_ACCOUNTS } from './skr03-class-2-accounts.model';
import { SKR03_CLASS_3_ACCOUNTS } from './skr03-class-3-accounts.model';
import { SKR03_CLASS_4_ACCOUNTS } from './skr03-class-4-accounts.model';
import { SKR03_CLASS_7_ACCOUNTS } from './skr03-class-7-accounts.model';
import { SKR03_CLASS_8_ACCOUNTS } from './skr03-class-8-accounts.model';
import { SKR03_CLASS_9_ACCOUNTS } from './skr03-class-9-accounts.model';

/**
 * The SKR 03, the standard chart ordered by the flow of the business (Prozessgliederungsprinzip), as valid for 2026:
 * class 0 the fixed assets, the long-term liabilities, the equity and the provisions, 1 the cash, the receivables and
 * the short-term liabilities, 2 the income and expenses outside the operations, 3 the purchases, 4 the operating
 * expenses, 7 the stock of products, 8 the revenue, and 9 the carry-forward and statistical accounts. Each account is
 * mapped to the position of the full HGB statements it is reported in. Nothing is seeded: spread `accounts` into the
 * accounts of a tenant.
 */
// the numbers, types and positions are facts of the frame; the names are written for it from what each account
// holds, and none is taken from the texts of the frame's publisher
export const skr03ChartOfAccounts: ChartOfAccounts = {
    id: 'skr03',
    name: 'SKR 03',
    accounts: ChartOfAccountsUtilities.resolveAccounts([
        ...SKR03_CLASS_0_ACCOUNTS,
        ...SKR03_CLASS_1_ACCOUNTS,
        ...SKR03_CLASS_2_ACCOUNTS,
        ...SKR03_CLASS_3_ACCOUNTS,
        ...SKR03_CLASS_4_ACCOUNTS,
        ...SKR03_CLASS_7_ACCOUNTS,
        ...SKR03_CLASS_8_ACCOUNTS,
        ...SKR03_CLASS_9_ACCOUNTS
    ])
};
