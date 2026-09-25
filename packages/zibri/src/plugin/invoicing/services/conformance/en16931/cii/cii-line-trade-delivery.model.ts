import { CiiNamespace } from './cii-namespace.enum';
import { CiiQuantity } from './cii-quantity.model';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

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