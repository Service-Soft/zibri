import { Property } from '../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator.ts';

/**
 * What an S3 compatible service answers a completed multipart upload with.
 */
export class S3CompleteMultipartUploadResult {
    /**
     * The entity tag of the object the parts became.
     */
    @XmlElement('ETag')
    @Property.string()
    eTag!: string;
}