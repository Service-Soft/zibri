import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtAccountId } from './camt-account-id.model';

/**
 * An account in a CAMT.053 statement: the one the statement is of, or one of a counterparty.
 */
export class CamtAccount {
    /**
     * What identifies the account.
     */
    @XmlElement('Id')
    @Property.object({ cls: () => CamtAccountId, allowAdditionalProperties: true })
    id!: CamtAccountId;

    /**
     * The currency the account is kept in.
     */
    @XmlElement('Ccy')
    @Property.string({ required: false })
    currency?: string;
}