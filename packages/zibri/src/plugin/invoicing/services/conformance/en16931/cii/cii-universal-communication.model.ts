import { CiiNamespace } from './cii-namespace.enum';
import { CiiSchemedId } from './cii-schemed-id.model';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * A way to reach someone: a phone number, or an address like an email address.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiUniversalCommunication {
    /**
     * The phone number.
     */
    @XmlElement('CompleteNumber')
    @Property.string({ required: false })
    completeNumber?: string;

    /**
     * The address.
     */
    @XmlElement('URIID')
    @Property.object({ cls: () => CiiSchemedId, required: false })
    uriId?: CiiSchemedId;
}