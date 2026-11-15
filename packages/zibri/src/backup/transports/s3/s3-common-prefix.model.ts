import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * The keys of a bucket listing that share a prefix up to the delimiter, listed once.
 */
export class S3CommonPrefix {
    /**
     * The prefix, the delimiter included.
     */
    @XmlElement('Prefix')
    @Property.string()
    prefix!: string;
}