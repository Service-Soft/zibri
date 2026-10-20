import { CiiExchangedDocumentContext } from './cii-exchanged-document-context.model.ts';
import { CiiExchangedDocument } from './cii-exchanged-document.model.ts';
import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiSupplyChainTradeTransaction } from './cii-supply-chain-trade-transaction.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlRoot } from '../../../../../../parsing/xml/xml-root.decorator.ts';

/**
 * A UN/CEFACT Cross Industry Invoice, the xml an EN16931 invoice is exchanged as.
 */
@XmlRoot({
    name: 'CrossIndustryInvoice',
    namespace: CiiNamespace.RSM,
    prefixes: { rsm: CiiNamespace.RSM, qdt: CiiNamespace.QDT, ram: CiiNamespace.RAM, xs: CiiNamespace.XS, udt: CiiNamespace.UDT }
})
export class CiiCrossIndustryInvoice {
    /**
     * The process and the specification the invoice follows.
     */
    @XmlElement('ExchangedDocumentContext')
    @Property.object({ cls: () => CiiExchangedDocumentContext })
    exchangedDocumentContext!: CiiExchangedDocumentContext;

    /**
     * The invoice as a document.
     */
    @XmlElement('ExchangedDocument')
    @Property.object({ cls: () => CiiExchangedDocument })
    exchangedDocument!: CiiExchangedDocument;

    /**
     * The trade the invoice is for.
     */
    @XmlElement('SupplyChainTradeTransaction')
    @Property.object({ cls: () => CiiSupplyChainTradeTransaction })
    supplyChainTradeTransaction!: CiiSupplyChainTradeTransaction;
}