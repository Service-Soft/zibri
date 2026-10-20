import { CiiLineDocument } from './cii-line-document.model.ts';
import { CiiLineTradeAgreement } from './cii-line-trade-agreement.model.ts';
import { CiiLineTradeDelivery } from './cii-line-trade-delivery.model.ts';
import { CiiLineTradeSettlement } from './cii-line-trade-settlement.model.ts';
import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiTradeProduct } from './cii-trade-product.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * One line of the invoice.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiTradeLineItem {
    /**
     * The position of the line.
     */
    @XmlElement('AssociatedDocumentLineDocument')
    @Property.object({ cls: () => CiiLineDocument })
    associatedDocument!: CiiLineDocument;

    /**
     * What the line is for.
     */
    @XmlElement('SpecifiedTradeProduct')
    @Property.object({ cls: () => CiiTradeProduct })
    product!: CiiTradeProduct;

    /**
     * What was agreed for the line.
     */
    @XmlElement('SpecifiedLineTradeAgreement')
    @Property.object({ cls: () => CiiLineTradeAgreement })
    agreement!: CiiLineTradeAgreement;

    /**
     * What was delivered for the line.
     */
    @XmlElement('SpecifiedLineTradeDelivery')
    @Property.object({ cls: () => CiiLineTradeDelivery })
    delivery!: CiiLineTradeDelivery;

    /**
     * How the line is settled.
     */
    @XmlElement('SpecifiedLineTradeSettlement')
    @Property.object({ cls: () => CiiLineTradeSettlement })
    settlement!: CiiLineTradeSettlement;
}