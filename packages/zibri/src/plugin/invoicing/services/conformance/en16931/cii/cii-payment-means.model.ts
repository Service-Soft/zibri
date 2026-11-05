import { CiiCreditorFinancialAccount } from './cii-creditor-financial-account.model';
import { CiiCreditorFinancialInstitution } from './cii-creditor-financial-institution.model';
import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * How the invoice is paid.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiPaymentMeans {
    /**
     * The kind of payment, eg. `58` for a SEPA credit transfer.
     */
    @XmlElement('TypeCode')
    @Property.string()
    typeCode!: string;

    /**
     * The account the invoice is paid to.
     */
    @XmlElement('PayeePartyCreditorFinancialAccount')
    @Property.object({ cls: () => CiiCreditorFinancialAccount })
    account!: CiiCreditorFinancialAccount;

    /**
     * The bank of that account.
     */
    @XmlElement('PayeeSpecifiedCreditorFinancialInstitution')
    @Property.object({ cls: () => CiiCreditorFinancialInstitution })
    institution!: CiiCreditorFinancialInstitution;
}