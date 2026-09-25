import { CiiDateTime } from './cii-date-time.model';
import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * When a delivery happened.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiSupplyChainEvent {
    /**
     * The date of the delivery.
     */
    @XmlElement('OccurrenceDateTime')
    @Property.object({ cls: () => CiiDateTime })
    occurrence!: CiiDateTime;
}