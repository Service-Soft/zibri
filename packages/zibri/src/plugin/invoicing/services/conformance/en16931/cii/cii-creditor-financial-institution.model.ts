import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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