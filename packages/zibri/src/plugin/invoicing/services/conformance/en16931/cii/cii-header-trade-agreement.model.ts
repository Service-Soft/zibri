import { CiiNamespace } from './cii-namespace.enum';
import { CiiTradeParty } from './cii-trade-party.model';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * Who the invoice is between.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiHeaderTradeAgreement {
    /**
     * The reference the buyer asked for.
     */
    @XmlElement('BuyerReference')
    @Property.string()
    buyerReference!: string;

    /**
     * The seller.
     */
    @XmlElement('SellerTradeParty')
    @Property.object({ cls: () => CiiTradeParty })
    seller!: CiiTradeParty;

    /**
     * The buyer.
     */
    @XmlElement('BuyerTradeParty')
    @Property.object({ cls: () => CiiTradeParty })
    buyer!: CiiTradeParty;
}