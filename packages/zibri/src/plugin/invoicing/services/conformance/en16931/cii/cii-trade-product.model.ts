import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

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