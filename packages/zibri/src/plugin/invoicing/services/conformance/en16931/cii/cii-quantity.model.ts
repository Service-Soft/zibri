import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlAttribute } from '../../../../../../parsing/xml/xml-attribute.decorator';
import { XmlText } from '../../../../../../parsing/xml/xml-text.decorator';

/**
 * A quantity, in the unit it names.
 */
export class CiiQuantity {
    /**
     * The code of the unit.
     */
    @XmlAttribute()
    @Property.string()
    unitCode!: string;

    /**
     * The quantity.
     */
    @XmlText()
    @Property.string()
    value!: string;
}