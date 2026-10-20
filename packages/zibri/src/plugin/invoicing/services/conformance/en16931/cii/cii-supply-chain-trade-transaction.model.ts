import { CiiHeaderTradeAgreement } from './cii-header-trade-agreement.model.ts';
import { CiiHeaderTradeDelivery } from './cii-header-trade-delivery.model.ts';
import { CiiHeaderTradeSettlement } from './cii-header-trade-settlement.model.ts';
import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiTradeLineItem } from './cii-trade-line-item.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * The trade the invoice is for: its lines, who it is between, the delivery and how it is settled.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiSupplyChainTradeTransaction {
    /**
     * The lines.
     */
    @XmlElement('IncludedSupplyChainTradeLineItem')
    @Property.array({ items: { type: 'object', cls: () => CiiTradeLineItem } })
    lineItems!: CiiTradeLineItem[];

    /**
     * Who the invoice is between.
     */
    @XmlElement('ApplicableHeaderTradeAgreement')
    @Property.object({ cls: () => CiiHeaderTradeAgreement })
    agreement!: CiiHeaderTradeAgreement;

    /**
     * The delivery.
     */
    @XmlElement('ApplicableHeaderTradeDelivery')
    @Property.object({ cls: () => CiiHeaderTradeDelivery })
    delivery!: CiiHeaderTradeDelivery;

    /**
     * How the invoice is settled.
     */
    @XmlElement('ApplicableHeaderTradeSettlement')
    @Property.object({ cls: () => CiiHeaderTradeSettlement })
    settlement!: CiiHeaderTradeSettlement;
}