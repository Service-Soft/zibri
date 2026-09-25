import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlAttribute } from '../../../../../../parsing/xml/xml-attribute.decorator';
import { XmlText } from '../../../../../../parsing/xml/xml-text.decorator';

/**
 * A date, written in the format its code names.
 */
export class CiiDateTimeString {
    /**
     * The code of the format, eg. `102` for CCYYMMDD.
     */
    @XmlAttribute()
    @Property.string()
    format!: string;

    /**
     * The date.
     */
    @XmlText()
    @Property.string()
    value!: string;
}