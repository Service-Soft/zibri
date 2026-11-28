import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * A code of a CAMT.053 statement out of the list of the standard, or one of the bank's own.
 */
export class CamtCode {
    /**
     * The code of the standard, such as `CLBD` for a closing booked balance.
     */
    @XmlElement('Cd')
    @Property.string({ required: false })
    code?: string;

    /**
     * The bank's own code.
     */
    @XmlElement('Prtry')
    @Property.string({ required: false })
    proprietary?: string;
}