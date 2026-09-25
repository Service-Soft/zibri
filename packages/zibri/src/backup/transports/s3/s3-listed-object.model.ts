import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * One object of a bucket listing.
 */
export class S3ListedObject {
    /**
     * The key of the object.
     */
    @XmlElement('Key')
    @Property.string()
    key!: string;
}