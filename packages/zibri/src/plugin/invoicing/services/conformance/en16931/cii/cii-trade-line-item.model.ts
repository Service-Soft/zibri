import { CiiLineDocument } from './cii-line-document.model';
import { CiiLineTradeAgreement } from './cii-line-trade-agreement.model';
import { CiiLineTradeDelivery } from './cii-line-trade-delivery.model';
import { CiiLineTradeSettlement } from './cii-line-trade-settlement.model';
import { CiiNamespace } from './cii-namespace.enum';
import { CiiTradeProduct } from './cii-trade-product.model';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

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