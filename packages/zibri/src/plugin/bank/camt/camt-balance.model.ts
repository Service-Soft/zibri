import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtAmount } from './camt-amount.model';
import { CamtBalanceType } from './camt-balance-type.model';
import { CamtCreditDebit } from './camt-credit-debit.enum';
import { CamtDate } from './camt-date.model';

/**
 * A balance of a CAMT.053 statement.
 */
export class CamtBalance {
    /**
     * Which balance it is.
     */
    @XmlElement('Tp')
    @Property.object({ cls: () => CamtBalanceType, allowAdditionalProperties: true })
    type!: CamtBalanceType;

    /**
     * The amount, without its sign.
     */
    @XmlElement('Amt')
    @Property.object({ cls: () => CamtAmount })
    amount!: CamtAmount;

    /**
     * Whether the balance is above or below zero.
     */
    @XmlElement('CdtDbtInd')
    @Property.string({ enum: CamtCreditDebit })
    creditDebit!: CamtCreditDebit;

    /**
     * The date of the balance.
     */
    @XmlElement('Dt')
    @Property.object({ cls: () => CamtDate })
    date!: CamtDate;
}