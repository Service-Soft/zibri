import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * What an S3 compatible service answers a started multipart upload with.
 */
export class S3InitiateMultipartUploadResult {
    /**
     * The id every part of the upload is sent under.
     */
    @XmlElement('UploadId')
    @Property.string()
    uploadId!: string;
}