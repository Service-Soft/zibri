import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';
import { CiiNamespace } from './cii-namespace.enum';

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