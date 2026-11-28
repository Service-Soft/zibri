import { type EBilanzPreviewModel } from 'zibri-contract';

import { Property } from '../../../../entity/decorators/property.decorator';
import { EBilanzContent } from './e-bilanz-content.model';
import { EBilanzFinding } from './e-bilanz-finding.model';

/**
 * The E-Bilanz of a fiscal year as the books state it now, and what it needs before it can be prepared.
 */
export class EBilanzPreparation implements Omit<EBilanzPreviewModel, 'content'> {
    /**
     * The content.
     */
    @Property.object({ cls: () => EBilanzContent })
    content!: EBilanzContent;

    /**
     * What it needs before it can be prepared, none when it can be.
     */
    @Property.array({ items: { type: 'object', cls: () => EBilanzFinding } })
    findings!: EBilanzFinding[];
}
