import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * A price.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiTradePrice {
    /**
     * The price per unit.
     */
    @XmlElement('ChargeAmount')
    @Property.string()
    chargeAmount!: string;
}