import { type BookkeepingStatementFormModel } from './bookkeeping-statement-form.model';

/**
 * The forms one statement of a fiscal year can be shown in, and the one that applies to it, as
 * `GET /bookkeeping/fiscal-years/:id/statement-forms` answers them.
 */
export type BookkeepingStatementFormChoiceModel = {
    /**
     * The id of the form that applies, which the statement is in when no form is named: the one its conformances
     * resolve, such as by the size class of a corporation, or the one archived at the closing of a closed year.
     */
    applies: string,
    /**
     * Every form the statement can be shown in: the full forms, and the shortened forms that roll up from them.
     */
    forms: BookkeepingStatementFormModel[]
};
