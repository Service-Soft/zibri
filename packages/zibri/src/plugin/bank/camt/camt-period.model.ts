import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * The period a CAMT.053 statement covers.
 */
export class CamtPeriod {
    /**
     * The start.
     */
    @XmlElement('FrDtTm')
    @Property.date()
    from!: Date;

    /**
     * The end.
     */
    @XmlElement('ToDtTm')
    @Property.date()
    to!: Date;
}