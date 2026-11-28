import { type EBilanzContentModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { EBilanzAccountingStandard } from './e-bilanz-accounting-standard.enum';
import { EBilanzField } from './e-bilanz-field.model';
import { EBilanzFixedAsset } from './e-bilanz-fixed-asset.model';
import { EBilanzIncomeStatementForm } from './e-bilanz-income-statement-form.enum';
import { EBilanzPosition } from './e-bilanz-position.model';
import { GermanBookkeepingCompany } from './german-bookkeeping-company.model';

/**
 * An E-Bilanz of a closed fiscal year, as zibri states it before it is written in a format: the positions of a version
 * of the HGB taxonomy with their amounts and the accounts under each, NIL for those the tax administration asks for
 * that the books cannot fill, the statement of changes in fixed assets, and the GCD module with the company.
 */
export class EBilanzContent implements Omit<EBilanzContentModel, 'start' | 'end' | 'positions' | 'fixedAssets' | 'fields' | 'company'> {
    /**
     * The id of the fiscal year.
     */
    @Property.string({ format: 'uuid' })
    fiscalYearId!: string;

    /**
     * The first day of the fiscal year.
     */
    @Property.date()
    start!: Date;

    /**
     * The last day of the fiscal year, the balance sheet date.
     */
    @Property.date()
    end!: Date;

    /**
     * The version of the HGB taxonomy, such as `6.9`.
     */
    @Property.string()
    taxonomyVersion!: string;

    /**
     * Which balance sheet it states.
     */
    @Property.string({ enum: EBilanzAccountingStandard })
    accountingStandard!: EBilanzAccountingStandard;

    /**
     * The form of the income statement.
     */
    @Property.string({ enum: EBilanzIncomeStatementForm })
    incomeStatementForm!: EBilanzIncomeStatementForm;

    /**
     * The company it states.
     */
    @Property.object({ cls: () => GermanBookkeepingCompany })
    company!: GermanBookkeepingCompany;

    /**
     * The positions, in the order of the taxonomy.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzPosition } })
    positions!: EBilanzPosition[];

    /**
     * The statement of changes in fixed assets.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzFixedAsset } })
    fixedAssets!: EBilanzFixedAsset[];

    /**
     * The fields of the GCD module.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzField } })
    fields!: EBilanzField[];
}