import { type BookkeepingStatementFormChoiceModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { BookkeepingStatementForm } from './bookkeeping-statement-form.model';

/**
 * The forms one statement of a fiscal year can be shown in, and the one that applies to it.
 */
export class BookkeepingStatementFormChoice implements BookkeepingStatementFormChoiceModel {
    /**
     * The id of the form that applies, which the statement is in when no form is named: the one the conformances of
     * the fiscal year resolve, or the one archived at its closing.
     */
    @Property.string()
    applies!: string;

    /**
     * Every structure of the statement, the full ones and those rolling up from them, in the order they are
     * registered.
     */
    @Property.array({ items: { type: 'object', cls: () => BookkeepingStatementForm } })
    forms!: BookkeepingStatementForm[];
}