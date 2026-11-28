import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { XmlRoot } from '../../../parsing/xml/xml-root.decorator';
import { CamtBankToCustomerStatement } from './camt-bank-to-customer-statement.model';

/**
 * A CAMT.053 file, of the parts the bank plugin reads. Both versions it reads are read as this model: where they
 * differ, it declares both.
 */
// no namespace: elements are read by their names alone, and the version is told by the namespace of the root
@XmlRoot({ name: 'Document' })
export class CamtDocument {
    /**
     * The statements of the file.
     */
    @XmlElement('BkToCstmrStmt')
    @Property.object({ cls: () => CamtBankToCustomerStatement, allowAdditionalProperties: true })
    bankToCustomerStatement!: CamtBankToCustomerStatement;
}