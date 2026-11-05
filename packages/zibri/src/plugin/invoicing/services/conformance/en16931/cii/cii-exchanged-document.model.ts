import { CiiDateTime } from './cii-date-time.model';
import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * The invoice as a document: its number, kind and date.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiExchangedDocument {
    /**
     * The invoice number.
     */
    @XmlElement('ID')
    @Property.string()
    id!: string;

    /**
     * The kind of document, eg. `380` for a commercial invoice.
     */
    @XmlElement('TypeCode')
    @Property.string()
    typeCode!: string;

    /**
     * When the invoice was issued.
     */
    @XmlElement('IssueDateTime')
    @Property.object({ cls: () => CiiDateTime })
    issueDateTime!: CiiDateTime;
}