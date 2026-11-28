import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtAccount } from './camt-account.model';
import { CamtParty } from './camt-party.model';

/**
 * Who paid and who was paid in a transaction of a CAMT.053 statement, and their accounts.
 */
export class CamtRelatedParties {
    /**
     * Who paid.
     */
    @XmlElement('Dbtr')
    @Property.object({ cls: () => CamtParty, required: false, allowAdditionalProperties: true })
    debtor?: CamtParty;

    /**
     * The account of who paid.
     */
    @XmlElement('DbtrAcct')
    @Property.object({ cls: () => CamtAccount, required: false, allowAdditionalProperties: true })
    debtorAccount?: CamtAccount;

    /**
     * Who was paid.
     */
    @XmlElement('Cdtr')
    @Property.object({ cls: () => CamtParty, required: false, allowAdditionalProperties: true })
    creditor?: CamtParty;

    /**
     * The account of who was paid.
     */
    @XmlElement('CdtrAcct')
    @Property.object({ cls: () => CamtAccount, required: false, allowAdditionalProperties: true })
    creditorAccount?: CamtAccount;
}