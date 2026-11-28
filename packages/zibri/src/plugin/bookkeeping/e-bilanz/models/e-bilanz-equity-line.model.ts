import { type BigNumber } from '../../../../utilities/number.utilities';

/**
 * A line on an account of the equity of an entry of a fiscal year other than its opening and its closing entry, as
 * the steuerlicher Betriebsvermögensvergleich (BVV) of an E-Bilanz reads the contributions and distributions from it.
 */
export type EBilanzEquityLine = {
    /**
     * The id of the entry of the line.
     */
    readonly entryId: string,
    /**
     * The id of the account.
     */
    readonly accountId: string,
    /**
     * The credit of the line less its debit.
     */
    readonly amount: BigNumber
};
