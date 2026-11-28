import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';
import { GdpduRange } from './gdpdu-range.model';

/**
 * The days a table of the description standard is valid for.
 */
export class GdpduValidity {
    /**
     * The first and the last day.
     */
    @XmlElement('Range')
    @Property.object({ cls: () => GdpduRange })
    range!: GdpduRange;

    /**
     * How the days are written, `DD.MM.YYYY`.
     */
    @XmlElement('Format')
    @Property.string()
    format!: string;
}
