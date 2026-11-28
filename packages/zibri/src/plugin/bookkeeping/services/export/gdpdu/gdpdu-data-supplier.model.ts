import { Property } from '../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../parsing/xml/xml-element.decorator';

/**
 * Who supplies the data of the description standard: the company, its seat, and a comment.
 */
export class GdpduDataSupplier {
    /**
     * The name of the company.
     */
    @XmlElement('Name')
    @Property.string()
    name!: string;

    /**
     * Its seat, or empty when the books do not name one.
     */
    @XmlElement('Location')
    @Property.string()
    location!: string;

    /**
     * What the export holds, and what checking the books found.
     */
    @XmlElement('Comment')
    @Property.string()
    comment!: string;
}
