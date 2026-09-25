import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * The bank of the account the invoice is paid to.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiCreditorFinancialInstitution {
    /**
     * The bic of the bank.
     */
    @XmlElement('BICID')
    @Property.string()
    bic!: string;
}