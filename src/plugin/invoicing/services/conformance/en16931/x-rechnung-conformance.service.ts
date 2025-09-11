import { Injectable } from '../../../../../di';
import { InvoiceConformance } from '../invoice-conformance-service.interface';
import { EN16931ConformanceService, EN16931DocumentContextId } from './en16931-conformance.service';

/**
 * Handles conforming to the X-Rechnung standard.
 */
@Injectable()
export class XRechnungConformanceService extends EN16931ConformanceService {
    override readonly name: InvoiceConformance = 'x-rechnung';
    override readonly documentContextId: EN16931DocumentContextId = 'urn:cen.eu:en16931:2017#compliant#urn:xrechnung:3.0';
}