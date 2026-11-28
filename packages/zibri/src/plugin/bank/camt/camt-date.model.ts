import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * A date of a CAMT.053 statement, given as a day or as a moment.
 */
export class CamtDate {
    /**
     * The day.
     */
    @XmlElement('Dt')
    @Property.date({ required: false })
    date?: Date;

    /**
     * The moment.
     */
    @XmlElement('DtTm')
    @Property.date({ required: false })
    dateTime?: Date;
}