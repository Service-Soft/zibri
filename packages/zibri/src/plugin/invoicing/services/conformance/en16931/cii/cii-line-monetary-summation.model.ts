import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * The total of a line.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiLineMonetarySummation {
    /**
     * The total, before tax.
     */
    @XmlElement('LineTotalAmount')
    @Property.string()
    lineTotalAmount!: string;
}