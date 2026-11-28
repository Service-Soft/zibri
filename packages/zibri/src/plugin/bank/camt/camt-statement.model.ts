import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtAccount } from './camt-account.model';
import { CamtBalance } from './camt-balance.model';
import { CamtEntry } from './camt-entry.model';
import { CamtPeriod } from './camt-period.model';

/**
 * One statement of a CAMT.053 file: the balances and the entries of one account over a period.
 */
export class CamtStatement {
    /**
     * The id the bank gave the statement.
     */
    @XmlElement('Id')
    @Property.string()
    id!: string;

    /**
     * The number the bank counts the statements of the account with.
     */
    @XmlElement('ElctrncSeqNb')
    @Property.number({ format: 'integer', required: false })
    electronicSequenceNumber?: number;

    /**
     * When the bank created the statement.
     */
    @XmlElement('CreDtTm')
    @Property.date()
    createdAt!: Date;

    /**
     * The period the statement covers.
     */
    @XmlElement('FrToDt')
    @Property.object({ cls: () => CamtPeriod, required: false })
    period?: CamtPeriod;

    /**
     * The account the statement is of.
     */
    @XmlElement('Acct')
    @Property.object({ cls: () => CamtAccount, allowAdditionalProperties: true })
    account!: CamtAccount;

    /**
     * The balances, among them the opening and the closing balance.
     */
    @XmlElement('Bal')
    @Property.array({ items: { type: 'object', cls: () => CamtBalance, allowAdditionalProperties: true } })
    balances!: CamtBalance[];

    /**
     * The entries, booked and pending.
     */
    @XmlElement('Ntry')
    @Property.array({ items: { type: 'object', cls: () => CamtEntry, allowAdditionalProperties: true }, required: false })
    entries?: CamtEntry[];
}