import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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