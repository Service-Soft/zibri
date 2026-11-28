import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { CamtAmountDetails } from './camt-amount-details.model';
import { CamtAmount } from './camt-amount.model';
import { CamtReferences } from './camt-references.model';
import { CamtRelatedParties } from './camt-related-parties.model';
import { CamtRemittanceInformation } from './camt-remittance-information.model';

/**
 * One transaction of an entry in a CAMT.053 statement. An entry booking several at once holds one for each.
 */
export class CamtTransactionDetails {
    /**
     * The references of the transaction.
     */
    @XmlElement('Refs')
    @Property.object({ cls: () => CamtReferences, required: false, allowAdditionalProperties: true })
    references?: CamtReferences;

    /**
     * The amount of the transaction, as `.001.08` names it.
     */
    @XmlElement('Amt')
    @Property.object({ cls: () => CamtAmount, required: false })
    amount?: CamtAmount;

    /**
     * The amounts of the transaction, as both versions name them.
     */
    @XmlElement('AmtDtls')
    @Property.object({ cls: () => CamtAmountDetails, required: false, allowAdditionalProperties: true })
    amountDetails?: CamtAmountDetails;

    /**
     * Who paid and who was paid.
     */
    @XmlElement('RltdPties')
    @Property.object({ cls: () => CamtRelatedParties, required: false, allowAdditionalProperties: true })
    relatedParties?: CamtRelatedParties;

    /**
     * The text the payer gave.
     */
    @XmlElement('RmtInf')
    @Property.object({ cls: () => CamtRemittanceInformation, required: false, allowAdditionalProperties: true })
    remittanceInformation?: CamtRemittanceInformation;
}