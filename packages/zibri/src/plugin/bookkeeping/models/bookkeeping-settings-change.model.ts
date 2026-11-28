import { type BookkeepingSettingsChangeModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { type CurrencyCode, currencyCodeEnum } from '../../../localization/models/currency-code.model';
import { type BookkeepingCompany } from './bookkeeping-company.model';
import { BookkeepingLegalForm } from './bookkeeping-legal-form.model';
import { resolveBookkeepingCompanyModel } from './resolve-bookkeeping-company-model.function';

/**
 * A change of the settings of the books of a tenant, as `PATCH /settings` of the `BookkeepingController` and
 * `updateSettings` of the journal service take it. Each property is unchanged when absent. The change is applied in
 * one transaction and validated as a whole: the conformances of each legal form of the resulting history check the
 * resulting settings, and a change that is refused writes nothing.
 */
export class BookkeepingSettingsChange implements BookkeepingSettingsChangeModel {
    /**
     * The currency the books are kept in, which changes only while there is no fiscal year. Unchanged when absent.
     */
    @Property.string({ enum: currencyCodeEnum, required: false })
    currency?: CurrencyCode | null;

    /**
     * A legal form appended to the history, valid from a day after the latest one and after the end of the last closed
     * fiscal year. Nothing is appended when absent.
     */
    @Property.object({ cls: () => BookkeepingLegalForm, required: false })
    legalForm?: BookkeepingLegalForm | null;

    /**
     * The company replacing the one of the settings whole, or null to remove it: what the company before held and this
     * one leaves out is gone. Of the class registered in `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL`. Unchanged
     * when absent.
     */
    @Property.object({ cls: () => resolveBookkeepingCompanyModel(), required: false })
    company?: BookkeepingCompany | null;
}
