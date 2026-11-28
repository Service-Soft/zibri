import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';
import { CiiDateTimeString } from './cii-date-time-string.model';
import { CiiNamespace } from './cii-namespace.enum';

/**
 * A date of a referenced document, written in a format its code names.
 */
@XmlNamespace(CiiNamespace.QDT)
export class CiiFormattedDateTime {
    /**
     * The date.
     */
    @XmlElement('DateTimeString')
    @Property.object({ cls: () => CiiDateTimeString })
    dateTimeString!: CiiDateTimeString;
}