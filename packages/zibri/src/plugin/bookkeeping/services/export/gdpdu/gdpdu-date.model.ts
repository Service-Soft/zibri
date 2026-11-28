import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';

/**
 * A column of the description standard holding days.
 */
export class GdpduDate {
    /**
     * How the days are written, `DD.MM.YYYY`.
     */
    @XmlElement('Format')
    @Property.string()
    format!: string;
}
