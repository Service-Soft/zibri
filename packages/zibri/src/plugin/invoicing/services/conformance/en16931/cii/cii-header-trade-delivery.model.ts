import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';
import { CiiNamespace } from './cii-namespace.enum';
import { CiiSupplyChainEvent } from './cii-supply-chain-event.model';

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