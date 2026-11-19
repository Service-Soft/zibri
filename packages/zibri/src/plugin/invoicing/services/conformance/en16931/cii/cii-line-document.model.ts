import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';
import { CiiNamespace } from './cii-namespace.enum';

/**
 * The position of a line in the invoice.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiLineDocument {
    /**
     * The number of the line.
     */
    @XmlElement('LineID')
    @Property.string()
    lineId!: string;
}