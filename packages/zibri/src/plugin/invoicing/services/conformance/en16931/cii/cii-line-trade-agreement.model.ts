import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiTradePrice } from './cii-trade-price.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * What was agreed for a line.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiLineTradeAgreement {
    /**
     * The net price per unit.
     */
    @XmlElement('NetPriceProductTradePrice')
    @Property.object({ cls: () => CiiTradePrice })
    netPrice!: CiiTradePrice;
}