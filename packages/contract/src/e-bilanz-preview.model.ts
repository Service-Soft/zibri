import { type EBilanzContentModel } from './e-bilanz-content.model';
import { type EBilanzFindingModel } from './e-bilanz-finding.model';

/**
 * The E-Bilanz of a fiscal year as the books state it now, and what it needs before it can be prepared, as
 * `POST /e-bilanz/fiscal-years/:id/preview` answers it: nothing of it is kept.
 */
export type EBilanzPreviewModel = {
    /**
     * The content, as a preparation would archive it.
     */
    content: EBilanzContentModel,
    /**
     * What it needs before it can be prepared, none when it can be.
     */
    findings: EBilanzFindingModel[]
};
