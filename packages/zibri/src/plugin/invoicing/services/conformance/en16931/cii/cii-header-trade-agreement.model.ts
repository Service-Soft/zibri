import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiTradeParty } from './cii-trade-party.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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