import { CiiDateTimeString } from './cii-date-time-string.model';
import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * A point in time, like an issue or a due date.
 */
@XmlNamespace(CiiNamespace.UDT)
export class CiiDateTime {
    /**
     * The date.
     */
    @XmlElement('DateTimeString')
    @Property.object({ cls: () => CiiDateTimeString })
    dateTimeString!: CiiDateTimeString;
}