import { CiiDateTime } from './cii-date-time.model.ts';
import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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