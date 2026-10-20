import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

/**
 * The account the invoice is paid to.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiCreditorFinancialAccount {
    /**
     * The iban of the account.
     */
    @XmlElement('IBANID')
    @Property.string()
    iban!: string;
}