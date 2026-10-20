import { Property } from '../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator.ts';

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