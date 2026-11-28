import { type BookkeepingSettingsModel } from 'zibri-contract';

import { BaseEntity } from '../../../entity/base-entity.model';
import { Entity } from '../../../entity/decorators/entity.decorator';
import { Property } from '../../../entity/decorators/property.decorator';
import { type CurrencyCode, currencyCodeEnum } from '../../../localization/models/currency-code.model';
import { type BookkeepingCompany } from './bookkeeping-company.model';
import { BookkeepingLegalForm } from './bookkeeping-legal-form.model';
import { resolveBookkeepingCompanyModel } from './resolve-bookkeeping-company-model.function';

/**
 * The settings of the books of a tenant, at most one row per tenant. A tenant keeps books once it has them: its
 * accounts, fiscal years and journal are its own.
 */
@Entity({ allowOrphan: true, uniques: [['tenantId']] })
export class BookkeepingSettings extends BaseEntity implements BookkeepingSettingsModel {
    /**
     * The tenant keeping the books.
     */
    @Property.string({ format: 'uuid' })
    tenantId!: string;

    /**
     * The currency the books are kept in, such as `EUR`. Every amount has its minor units. It changes only while there
     * is no fiscal year.
     */
    @Property.string({ enum: currencyCodeEnum })
    currency!: CurrencyCode;

    /**
     * The history of the legal form of the tenant, the earliest first, such as a `UG` from 2025-01-01 and a `GmbH`
     * from 2027-06-01. The one valid at the end of a fiscal year decides which conformances apply to it. A legal form
     * is only appended, valid from after the end of the last closed fiscal year.
     */
    @Property.array({ items: { type: 'object', cls: () => BookkeepingLegalForm } })
    legalForms!: BookkeepingLegalForm[];

    /**
     * The company whose books they are, which its statements name, or null for none. Required by the conformances of
     * some legal forms, such as a GmbH. Of the class registered in `ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.COMPANY_MODEL`.
     */
    @Property.object({ cls: () => resolveBookkeepingCompanyModel(), required: false })
    company?: BookkeepingCompany | null;
}

/**
 * What the settings are created with.
 */
export type BookkeepingSettingsCreateData = Pick<BookkeepingSettings, 'currency' | 'legalForms' | 'company'>;