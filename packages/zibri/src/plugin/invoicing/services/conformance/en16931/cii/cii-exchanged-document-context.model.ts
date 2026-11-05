import { CiiId } from './cii-id.model';
import { CiiNamespace } from './cii-namespace.enum';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * The process and the specification the invoice follows.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiExchangedDocumentContext {
    /**
     * The business process.
     */
    @XmlElement('BusinessProcessSpecifiedDocumentContextParameter')
    @Property.object({ cls: () => CiiId })
    businessProcess!: CiiId;

    /**
     * The specification, eg. XRechnung or Peppol.
     */
    @XmlElement('GuidelineSpecifiedDocumentContextParameter')
    @Property.object({ cls: () => CiiId })
    guideline!: CiiId;
}