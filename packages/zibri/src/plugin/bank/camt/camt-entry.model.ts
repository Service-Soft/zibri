import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtAmount } from './camt-amount.model';
import { CamtCreditDebit } from './camt-credit-debit.enum';
import { CamtDate } from './camt-date.model';
import { CamtEntryDetails } from './camt-entry-details.model';
import { CamtEntryStatus } from './camt-entry-status.model';

/**
 * An entry of a CAMT.053 statement: one booking on the account, of one transaction or of several at once.
 */
export class CamtEntry {
    /**
     * The amount, without its sign.
     */
    @XmlElement('Amt')
    @Property.object({ cls: () => CamtAmount })
    amount!: CamtAmount;

    /**
     * Whether the money was received or paid.
     */
    @XmlElement('CdtDbtInd')
    @Property.string({ enum: CamtCreditDebit })
    creditDebit!: CamtCreditDebit;

    /**
     * Whether the entry reverses an earlier one, such as a returned direct debit.
     */
    @XmlElement('RvslInd')
    @Property.boolean({ required: false })
    reversal?: boolean;

    /**
     * Whether the entry is booked.
     */
    @XmlElement('Sts')
    @Property.object({ cls: () => CamtEntryStatus, allowAdditionalProperties: true })
    status!: CamtEntryStatus;

    /**
     * When the bank booked the entry.
     */
    @XmlElement('BookgDt')
    @Property.object({ cls: () => CamtDate, required: false })
    bookingDate?: CamtDate;

    /**
     * When the money counts as received or paid.
     */
    @XmlElement('ValDt')
    @Property.object({ cls: () => CamtDate, required: false })
    valueDate?: CamtDate;

    /**
     * The reference the bank gave the entry.
     */
    @XmlElement('AcctSvcrRef')
    @Property.string({ required: false })
    bankReference?: string;

    /**
     * The transactions the entry books.
     */
    @XmlElement('NtryDtls')
    @Property.array({ items: { type: 'object', cls: () => CamtEntryDetails, allowAdditionalProperties: true }, required: false })
    details?: CamtEntryDetails[];
}