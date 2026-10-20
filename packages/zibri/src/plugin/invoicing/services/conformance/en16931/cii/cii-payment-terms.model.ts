import { CiiDateTime } from './cii-date-time.model.ts';
import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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