import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';
import { CiiDateTime } from './cii-date-time.model';
import { CiiNamespace } from './cii-namespace.enum';

/**
 * When the invoice has to be paid.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiPaymentTerms {
    /**
     * The due date.
     */
    @XmlElement('DueDateDateTime')
    @Property.object({ cls: () => CiiDateTime })
    dueDate!: CiiDateTime;
}