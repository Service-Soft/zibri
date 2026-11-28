import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';

/**
 * A column of the description standard holding numbers.
 */
export class GdpduNumeric {
    /**
     * How many digits follow the decimal symbol, such as `2` for an amount in EUR.
     */
    @XmlElement('Accuracy')
    @Property.number({ format: 'integer', min: 0 })
    accuracy!: number;
}