import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * What identifies an account in a CAMT.053 statement: its IBAN, or a number of another scheme.
 */
export class CamtAccountId {
    /**
     * The IBAN.
     */
    @XmlElement('IBAN')
    @Property.string({ required: false })
    iban?: string;
}