import { type BigNumber } from '../../../../../utilities/number.utilities';

/**
 * The legal reserve of a UG for a fiscal year, § 5a (3) GmbHG: a quarter of its net income, less a loss carried
 * forward from the year before.
 */
export type UgLegalReserve = {
    /**
     * The net income of the fiscal year, its revenue less its expenses, below 0 for a loss.
     */
    surplus: BigNumber,
    /**
     * The loss carried forward from the year before, as a positive amount, or 0 for none.
     */
    lossCarriedForward: BigNumber,
    /**
     * What the reserve needs to be increased by, rounded up to the minor units of the currency, or 0 for a year
     * without a surplus left after the loss.
     */
    reserve: BigNumber,
    /**
     * What is posted to the legal reserve account in the fiscal year, besides its opening balance.
     */
    posted: BigNumber
};