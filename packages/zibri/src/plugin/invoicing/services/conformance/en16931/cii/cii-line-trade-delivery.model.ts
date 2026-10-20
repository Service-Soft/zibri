import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiQuantity } from './cii-quantity.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * What was delivered for a line.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiLineTradeDelivery {
    /**
     * How much was billed.
     */
    @XmlElement('BilledQuantity')
    @Property.object({ cls: () => CiiQuantity })
    billedQuantity!: CiiQuantity;
}