import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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