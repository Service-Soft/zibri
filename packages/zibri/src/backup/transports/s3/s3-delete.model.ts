import { S3ObjectIdentifier } from './s3-object-identifier.model';
import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { XmlRoot } from '../../../parsing/xml/xml-root.decorator';

/**
 * The request that deletes several objects at once, up to 1,000.
 */
@XmlRoot({ name: 'Delete', namespace: 'http://s3.amazonaws.com/doc/2006-03-01/' })
export class S3Delete {
    /**
     * The objects to delete.
     */
    @XmlElement('Object')
    @Property.array({ items: { type: 'object', cls: () => S3ObjectIdentifier } })
    objects!: S3ObjectIdentifier[];

    /**
     * Whether the answer leaves out the objects that were deleted, naming only those that were not.
     */
    @XmlElement('Quiet')
    @Property.boolean()
    quiet!: boolean;
}