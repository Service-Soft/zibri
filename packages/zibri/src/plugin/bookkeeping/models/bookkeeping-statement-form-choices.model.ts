import { type BookkeepingStatementFormChoicesModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingStatementFormChoice } from './bookkeeping-statement-form-choice.model';

/**
 * The forms the balance sheet and the income statement of a fiscal year can be shown in, as
 * `resolveStatementFormChoices` of the report service answers them.
 */
export class BookkeepingStatementFormChoices implements BookkeepingStatementFormChoicesModel {
    /**
     * The id of the fiscal year.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The forms of its balance sheet.
     */
    @Property.object({ cls: () => BookkeepingStatementFormChoice })
    balanceSheet!: BookkeepingStatementFormChoice;

    /**
     * The forms of its income statement.
     */
    @Property.object({ cls: () => BookkeepingStatementFormChoice })
    incomeStatement!: BookkeepingStatementFormChoice;
}