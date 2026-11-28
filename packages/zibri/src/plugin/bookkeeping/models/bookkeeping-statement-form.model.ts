import { type BookkeepingStatementFormModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * A form a statement of a fiscal year can be shown in: a structure of
 * `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.STATEMENT_STRUCTURES`, with its name translated.
 */
export class BookkeepingStatementForm implements BookkeepingStatementFormModel {
    /**
     * The id of the structure, which a statement takes as its form, such as `hgb.balance-sheet.small`.
     */
    @Property.string()
    id!: string;

    /**
     * The name of the structure, or its label for one without, in the locale of the request.
     */
    @Property.string()
    name!: string;
}
