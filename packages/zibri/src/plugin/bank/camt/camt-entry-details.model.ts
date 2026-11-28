import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtTransactionDetails } from './camt-transaction-details.model';

/**
 * The transactions an entry of a CAMT.053 statement books.
 */
export class CamtEntryDetails {
    /**
     * The transactions.
     */
    @XmlElement('TxDtls')
    @Property.array({ items: { type: 'object', cls: () => CamtTransactionDetails, allowAdditionalProperties: true }, required: false })
    transactions?: CamtTransactionDetails[];
}