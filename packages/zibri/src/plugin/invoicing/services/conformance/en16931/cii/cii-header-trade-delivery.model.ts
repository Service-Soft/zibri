import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiSupplyChainEvent } from './cii-supply-chain-event.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * The delivery the invoice is for.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiHeaderTradeDelivery {
    /**
     * When the delivery happened.
     */
    @XmlElement('ActualDeliverySupplyChainEvent')
    @Property.object({ cls: () => CiiSupplyChainEvent })
    event!: CiiSupplyChainEvent;
}