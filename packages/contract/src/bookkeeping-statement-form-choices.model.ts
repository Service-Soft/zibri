import { type BookkeepingStatementFormChoiceModel } from './bookkeeping-statement-form-choice.model';

/**
 * The forms the balance sheet and the income statement of a fiscal year can be shown in, as
 * `GET /bookkeeping/fiscal-years/:id/statement-forms` answers them.
 */
export type BookkeepingStatementFormChoicesModel = {
    /**
     * The id of the fiscal year.
     */
    fiscalYearId: string,
    /**
     * The forms of its balance sheet.
     */
    balanceSheet: BookkeepingStatementFormChoiceModel,
    /**
     * The forms of its income statement.
     */
    incomeStatement: BookkeepingStatementFormChoiceModel
};