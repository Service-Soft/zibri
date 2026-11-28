import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';

/**
 * A range of the description standard: the first record a table is read from, or the first and the last day it is
 * valid for.
 */
export class GdpduRange {
    /**
     * Where it starts, such as `2` for the record after the header, or `01.01.2026`.
     */
    @XmlElement('From')
    @Property.string()
    from!: string;

    /**
     * Where it ends, such as `31.12.2026`, or undefined for the end of the table.
     */
    @XmlElement('To')
    @Property.string({ required: false })
    to?: string;
}
