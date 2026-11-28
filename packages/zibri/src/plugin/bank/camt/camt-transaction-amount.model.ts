import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtAmount } from './camt-amount.model';

/**
 * The amount of one transaction of an entry in a CAMT.053 statement.
 */
export class CamtTransactionAmount {
    /**
     * The amount, without its sign.
     */
    @XmlElement('Amt')
    @Property.object({ cls: () => CamtAmount })
    amount!: CamtAmount;
}