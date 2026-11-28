import { type BigNumber } from '../../../../../utilities/number.utilities';

/**
 * The upper limits of a size class of § 267 or § 267a HGB. A corporation is of the class on a balance sheet date
 * when it exceeds at most one of them.
 */
export type HgbSizeThreshold = {
    /**
     * The balance sheet total, in EUR.
     */
    balanceSheetTotal: BigNumber,
    /**
     * The revenue of the fiscal year, in EUR.
     */
    revenue: BigNumber,
    /**
     * The average number of employees.
     */
    employees: number
};