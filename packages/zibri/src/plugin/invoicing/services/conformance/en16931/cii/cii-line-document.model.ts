import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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