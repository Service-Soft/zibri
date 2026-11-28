import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtTransactionAmount } from './camt-transaction-amount.model';

/**
 * The amounts of one transaction of an entry in a CAMT.053 statement.
 */
export class CamtAmountDetails {
    /**
     * The amount booked on the account.
     */
    @XmlElement('TxAmt')
    @Property.object({ cls: () => CamtTransactionAmount, required: false, allowAdditionalProperties: true })
    transactionAmount?: CamtTransactionAmount;
}