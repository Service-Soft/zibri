import { type NewBookkeepingSettingsModel } from 'zibri-contract';

import { Property } from '../../../entity/decorators/property.decorator';
import { type CurrencyCode, currencyCodeEnum } from '../../../localization/models/currency-code.model';
import { type BookkeepingCompany } from './bookkeeping-company.model';
import { BookkeepingLegalForm } from './bookkeeping-legal-form.model';
import { resolveBookkeepingCompanyModel } from './resolve-bookkeeping-company-model.function';

/**
 * The settings to start the books of a tenant with, as `POST /settings` of the `BookkeepingController` and
 * `createSettings` of the journal service take them.
 */
export class NewBookkeepingSettings implements NewBookkeepingSettingsModel {
    /**
     * The currency the books are kept in, such as `EUR`.
     */
    @Property.string({ enum: currencyCodeEnum })
    currency!: CurrencyCode;

    /**
     * The history of the legal form of the tenant, the earliest first.
     */
    @Property.array({ items: { type: 'object', cls: () => BookkeepingLegalForm } })
    legalForms!: BookkeepingLegalForm[];

    /**
     * The company whose books they are, or null for none. A corporation under the HGB names its name, seat, register
     * court and register number. Of the class registered in `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL`.
     */
    @Property.object({ cls: () => resolveBookkeepingCompanyModel(), required: false })
    company?: BookkeepingCompany | null;
}