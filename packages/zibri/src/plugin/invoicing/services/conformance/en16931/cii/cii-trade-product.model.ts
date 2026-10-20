import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * What a line is for.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiTradeProduct {
    /**
     * The name of the product.
     */
    @XmlElement('Name')
    @Property.string()
    name!: string;
}