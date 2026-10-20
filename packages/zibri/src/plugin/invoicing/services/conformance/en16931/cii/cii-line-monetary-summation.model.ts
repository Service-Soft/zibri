import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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