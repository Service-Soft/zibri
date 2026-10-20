import { Property } from '../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator.ts';

/**
 * One uploaded part of a multipart upload, as the upload is completed with it.
 */
export class S3CompletedPart {
    /**
     * The position of the part in the object, from 1.
     */
    @XmlElement('PartNumber')
    @Property.number({ format: 'integer' })
    partNumber!: number;

    /**
     * What the service answered the upload of the part with.
     */
    @XmlElement('ETag')
    @Property.string()
    eTag!: string;
}