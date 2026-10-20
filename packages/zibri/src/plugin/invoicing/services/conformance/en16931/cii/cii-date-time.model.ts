import { CiiDateTimeString } from './cii-date-time-string.model.ts';
import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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