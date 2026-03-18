import { Injectable } from '../../../../../di/decorators/injectable.decorator';
import { InvoiceConformance } from '../invoice-conformance-service.interface';
import { EN16931ConformanceService, EN16931DocumentContextId } from './en16931-conformance.service';

/**
 * Handles conforming to the peppol standard.
 */
@Injectable({ register: 'onUse' })
export class PeppolConformanceService extends EN16931ConformanceService {
    override readonly name: InvoiceConformance = 'peppol';
    // eslint-disable-next-line stylistic/max-len
    override readonly documentContextId: EN16931DocumentContextId = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';
}