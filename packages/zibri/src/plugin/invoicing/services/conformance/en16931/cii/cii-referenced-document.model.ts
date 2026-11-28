import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';
import { CiiFormattedDateTime } from './cii-formatted-date-time.model';
import { CiiNamespace } from './cii-namespace.enum';

/**
 * A document the invoice references, such as the invoice a credit note corrects.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiReferencedDocument {
    /**
     * The number of the document.
     */
    @XmlElement('IssuerAssignedID')
    @Property.string()
    issuerAssignedId!: string;

    /**
     * When the document was issued.
     */
    @XmlElement('FormattedIssueDateTime')
    @Property.object({ cls: () => CiiFormattedDateTime, required: false })
    formattedIssueDateTime?: CiiFormattedDateTime;
}