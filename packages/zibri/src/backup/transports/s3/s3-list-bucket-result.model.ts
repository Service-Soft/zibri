import { S3ListedObject } from './s3-listed-object.model';
import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * One page of a bucket listing.
 */
export class S3ListBucketResult {
    /**
     * Whether there are more objects than this page holds.
     */
    @XmlElement('IsTruncated')
    @Property.boolean()
    isTruncated!: boolean;

    /**
     * What the next page is asked for with, when there is one.
     */
    @XmlElement('NextContinuationToken')
    @Property.string({ required: false })
    nextContinuationToken?: string;

    /**
     * The objects on this page.
     */
    @XmlElement('Contents')
    @Property.array({ required: false, items: { type: 'object', cls: () => S3ListedObject, allowAdditionalProperties: true } })
    contents?: S3ListedObject[];
}