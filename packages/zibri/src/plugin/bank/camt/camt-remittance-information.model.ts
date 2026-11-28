import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';

/**
 * The text a payer gave a transaction in a CAMT.053 statement.
 */
export class CamtRemittanceInformation {
    /**
     * The text, in lines of at most 140 characters.
     */
    @XmlElement('Ustrd')
    @Property.array({ items: { type: 'string' }, required: false })
    unstructured?: string[];
}