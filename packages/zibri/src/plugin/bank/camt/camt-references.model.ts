import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * The references of a transaction in a CAMT.053 statement.
 */
export class CamtReferences {
    /**
     * The reference the payer gave the payment.
     */
    @XmlElement('EndToEndId')
    @Property.string({ required: false })
    endToEndId?: string;

    /**
     * The mandate of a direct debit.
     */
    @XmlElement('MndtId')
    @Property.string({ required: false })
    mandateId?: string;
}