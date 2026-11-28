import { Property } from '../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../parsing/xml/xml-element.decorator';
import { XmlText } from '../../../parsing/xml/xml-text.decorator';

/**
 * Whether an entry of a CAMT.053 statement is booked, such as `BOOK`, or still pending, such as `PDNG`.
 */
// both versions in one model: `.001.02` writes the code as the text of the element, `.001.08` in `Cd`
export class CamtEntryStatus {
    /**
     * The code, as `.001.02` writes it. Whitespace only in `.001.08`, around its `Cd`.
     */
    @XmlText()
    @Property.string({ required: false })
    text?: string;

    /**
     * The code, as `.001.08` writes it.
     */
    @XmlElement('Cd')
    @Property.string({ required: false })
    code?: string;
}