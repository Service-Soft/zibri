import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * An object a request to delete several could not delete.
 */
export class S3DeleteError {
    /**
     * The key of the object.
     */
    @XmlElement('Key')
    @Property.string()
    key!: string;

    /**
     * Why, as a code such as `AccessDenied`.
     */
    @XmlElement('Code')
    @Property.string()
    code!: string;

    /**
     * Why, in words.
     */
    @XmlElement('Message')
    @Property.string({ required: false })
    message?: string;
}