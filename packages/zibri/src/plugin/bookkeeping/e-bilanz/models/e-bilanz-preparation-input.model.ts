import { type EBilanzPreparationInputModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { EBilanzAccountingStandard } from './e-bilanz-accounting-standard.enum';
import { EBilanzFixedAssetInput } from './e-bilanz-fixed-asset-input.model';
import { EBilanzRevisionStatus } from './e-bilanz-revision-status.enum';

/**
 * What preparing an E-Bilanz takes beside the books, as `POST /e-bilanz/fiscal-years/:id/preparation` takes it.
 */
export class EBilanzPreparationInput implements Omit<EBilanzPreparationInputModel, 'fixedAssets'> {
    /**
     * Which balance sheet it states, the commercial one that is the tax balance sheet as well, or a tax balance sheet
     * of its own. Required, as both are what a company may file.
     */
    @Property.string({ enum: EBilanzAccountingStandard })
    accountingStandard!: EBilanzAccountingStandard;

    /**
     * The version of the taxonomy, or null for the one the fiscal year needs to be stated in.
     */
    @Property.string({ required: false })
    taxonomyVersion?: string | null;

    /**
     * The figures of the statement of changes in fixed assets the books do not hold.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzFixedAssetInput }, required: false })
    fixedAssets?: EBilanzFixedAssetInput[] | null;

    /**
     * How the E-Bilanz corrects the one filed before, required once the fiscal year is filed and refused before.
     * `original` while it is not filed, by default.
     */
    @Property.string({ enum: EBilanzRevisionStatus, required: false })
    revisionStatus?: EBilanzRevisionStatus | null;
}
