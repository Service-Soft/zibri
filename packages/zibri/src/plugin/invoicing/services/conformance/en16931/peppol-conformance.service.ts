import { CiiSchemedId } from './cii/cii-schemed-id.model.ts';
import { EN16931ConformanceService, EN16931DocumentContextId } from './en16931-conformance.service.ts';
import { Injectable } from '../../../../../di/decorators/injectable.decorator.ts';
import { InternalError } from '../../../../../error-handling/internal-error.model.ts';
import { BigNumber, NumberUtilities } from '../../../../../utilities/number.utilities.ts';
import { ElectronicAddress } from '../../../models/electronic-address.model.ts';
import { Invoice } from '../../../models/invoice.model.ts';
import { InvoiceConformance } from '../invoice-conformance-service.interface.ts';

/**
 * Handles conforming to the peppol standard.
 */
@Injectable({ register: 'onUse' })
export class PeppolConformanceService extends EN16931ConformanceService {
    override readonly name: InvoiceConformance = 'peppol';
    override readonly documentContextId: EN16931DocumentContextId = 'urn:cen.eu:en16931:2017#compliant#urn:fdc:peppol.eu:2017:poacc:billing:3.0';

    protected override async validateInvoice(invoice: Invoice): Promise<void> {
        await super.validateInvoice(invoice);
        for (const [i, item] of invoice.items.entries()) {
            // a line rounded to a currency without minor units can be half a unit from its quantity
            // times its price, which Peppol refuses where EN 16931 does not
            const exact: BigNumber = NumberUtilities.multiply(item.amount, item.price);
            const rounded: BigNumber = await this.invoiceCalcService.getItemTotalPriceBeforeTax(item, invoice.currency);
            if (
                NumberUtilities.subtract(rounded, exact)
                    .abs()
                    .isGreaterThan(0.02)
            ) {
                throw new InternalError(
                    'Peppol allows the amount of a line to be at most 0.02 from its quantity times its price (PEPPOL-EN16931-R120), '
                    + `and line ${i + 1} is ${item.amount} × ${item.price} = ${exact.toFixed()} ${invoice.currency}, `
                    + `rounded to ${this.getAmount(rounded, invoice)}.`
                );
            }
        }
    }

    protected override resolveElectronicAddress(
        party: 'seller' | 'buyer',
        electronicAddress: ElectronicAddress | null | undefined,
        email: string | null | undefined
    ): CiiSchemedId {
        // Peppol's scheme list has no email (PEPPOL-EN16931-CL008): a party is named by the address
        // it receives invoices at in the network
        if (electronicAddress == undefined) {
            const field: string = party === 'seller' ? 'CompanyInfo.electronicAddress' : 'InvoiceAddress.electronicAddress';
            throw new InternalError(
                `Peppol names a party by its electronic address and not by its email: provide one for the ${party} (${field}).`
            );
        }
        return super.resolveElectronicAddress(party, electronicAddress, email);
    }
}