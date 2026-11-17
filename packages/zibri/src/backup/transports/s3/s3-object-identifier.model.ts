import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * One object a request names, by its key.
 */
export class S3ObjectIdentifier {
    /**
     * The key of the object.
     */
    @XmlElement('Key')
    @Property.string()
    key!: string;
}