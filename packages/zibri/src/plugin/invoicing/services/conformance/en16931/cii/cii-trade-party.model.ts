import { CiiId } from './cii-id.model.ts';
import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiTaxRegistration } from './cii-tax-registration.model.ts';
import { CiiTradeAddress } from './cii-trade-address.model.ts';
import { CiiTradeContact } from './cii-trade-contact.model.ts';
import { CiiUniversalCommunication } from './cii-universal-communication.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * The seller or the buyer.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiTradeParty {
    /**
     * The name of the party.
     */
    @XmlElement('Name')
    @Property.string()
    name!: string;

    /**
     * The organization the party is registered as, for the seller.
     */
    @XmlElement('SpecifiedLegalOrganization')
    @Property.object({ cls: () => CiiId, required: false })
    legalOrganization?: CiiId;

    /**
     * Who to contact, for the seller.
     */
    @XmlElement('DefinedTradeContact')
    @Property.object({ cls: () => CiiTradeContact, required: false })
    contact?: CiiTradeContact;

    /**
     * The address of the party.
     */
    @XmlElement('PostalTradeAddress')
    @Property.object({ cls: () => CiiTradeAddress })
    address!: CiiTradeAddress;

    /**
     * The electronic address of the party.
     */
    @XmlElement('URIUniversalCommunication')
    @Property.object({ cls: () => CiiUniversalCommunication })
    communication!: CiiUniversalCommunication;

    /**
     * The numbers the party is registered for tax under, for the seller.
     */
    @XmlElement('SpecifiedTaxRegistration')
    @Property.array({ items: { type: 'object', cls: () => CiiTaxRegistration }, required: false })
    taxRegistrations?: CiiTaxRegistration[];
}