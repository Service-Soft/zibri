import { CiiHeaderMonetarySummation } from './cii-header-monetary-summation.model.ts';
import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiPaymentMeans } from './cii-payment-means.model.ts';
import { CiiPaymentTerms } from './cii-payment-terms.model.ts';
import { CiiTradeTax } from './cii-trade-tax.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * How the invoice is settled.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiHeaderTradeSettlement {
    /**
     * The currency of the invoice.
     */
    @XmlElement('InvoiceCurrencyCode')
    @Property.string()
    currency!: string;

    /**
     * How the invoice is paid.
     */
    @XmlElement('SpecifiedTradeSettlementPaymentMeans')
    @Property.object({ cls: () => CiiPaymentMeans })
    paymentMeans!: CiiPaymentMeans;

    /**
     * The taxes, one per rate.
     */
    @XmlElement('ApplicableTradeTax')
    @Property.array({ items: { type: 'object', cls: () => CiiTradeTax } })
    taxes!: CiiTradeTax[];

    /**
     * When the invoice has to be paid.
     */
    @XmlElement('SpecifiedTradePaymentTerms')
    @Property.object({ cls: () => CiiPaymentTerms })
    paymentTerms!: CiiPaymentTerms;

    /**
     * The totals.
     */
    @XmlElement('SpecifiedTradeSettlementHeaderMonetarySummation')
    @Property.object({ cls: () => CiiHeaderMonetarySummation })
    summation!: CiiHeaderMonetarySummation;
}