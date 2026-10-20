import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlAttribute } from '../../../../../../parsing/xml/xml-attribute.decorator.ts';
import { XmlText } from '../../../../../../parsing/xml/xml-text.decorator.ts';

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