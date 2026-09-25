import { S3CompletedPart } from './s3-completed-part.model';
import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { XmlRoot } from '../../../parsing/xml/xml-root.decorator';

/**
 * The request that completes a multipart upload, naming the parts it is made of.
 */
@XmlRoot({ name: 'CompleteMultipartUpload', namespace: 'http://s3.amazonaws.com/doc/2006-03-01/' })
export class S3CompleteMultipartUpload {
    /**
     * The uploaded parts, in order.
     */
    @XmlElement('Part')
    @Property.array({ items: { type: 'object', cls: () => S3CompletedPart } })
    parts!: S3CompletedPart[];
}