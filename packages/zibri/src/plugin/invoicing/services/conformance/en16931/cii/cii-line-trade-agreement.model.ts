import { CiiNamespace } from './cii-namespace.enum';
import { CiiTradePrice } from './cii-trade-price.model';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

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