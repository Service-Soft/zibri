import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';

/**
 * Which column of the table a foreign key of the description standard references a column of another name in.
 */
export class GdpduAlias {
    /**
     * The column of the foreign key, such as `accountId`.
     */
    @XmlElement('From')
    @Property.string()
    from!: string;

    /**
     * The column it references, such as `id`.
     */
    @XmlElement('To')
    @Property.string()
    to!: string;
}
