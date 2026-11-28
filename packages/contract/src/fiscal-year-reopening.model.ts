/**
 * How to reopen a closed fiscal year to correct its books, as `POST /bookkeeping/fiscal-years/:id/reopening` takes it.
 */
export type FiscalYearReopeningModel = {
    /**
     * Why the fiscal year is reopened, such as the error to correct. The text of the entries reversing its closing.
     */
    reason: string,
    /**
     * Whether it is reopened to correct accounts already filed with the tax administration, such as an E-Bilanz
     * accepted, which is then filed again as a correction. A fiscal year whose accounts are filed is reopened only so.
     * False by default.
     */
    forCorrection?: boolean | null
};