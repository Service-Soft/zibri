import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * Something identified by an id, like a document context parameter or a legal organization.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiId {
    /**
     * The id.
     */
    @XmlElement('ID')
    @Property.string()
    id!: string;
}