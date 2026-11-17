import { S3DeleteError } from './s3-delete-error.model';
import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * What a request to delete several objects is answered with, quietly: the objects it could not delete.
 */
export class S3DeleteResult {
    /**
     * The objects that were not deleted, none when every one was.
     */
    @XmlElement('Error')
    @Property.array({ required: false, items: { type: 'object', cls: () => S3DeleteError, allowAdditionalProperties: true } })
    errors?: S3DeleteError[];
}