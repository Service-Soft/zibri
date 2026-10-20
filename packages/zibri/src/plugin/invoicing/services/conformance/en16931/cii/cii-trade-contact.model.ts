import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiUniversalCommunication } from './cii-universal-communication.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * The person to contact about the invoice.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiTradeContact {
    /**
     * The name of the person.
     */
    @XmlElement('PersonName')
    @Property.string()
    personName!: string;

    /**
     * Their phone number.
     */
    @XmlElement('TelephoneUniversalCommunication')
    @Property.object({ cls: () => CiiUniversalCommunication })
    telephone!: CiiUniversalCommunication;

    /**
     * Their email address.
     */
    @XmlElement('EmailURIUniversalCommunication')
    @Property.object({ cls: () => CiiUniversalCommunication })
    email!: CiiUniversalCommunication;
}