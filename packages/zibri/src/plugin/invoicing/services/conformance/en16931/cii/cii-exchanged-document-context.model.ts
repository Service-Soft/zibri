import { CiiId } from './cii-id.model.ts';
import { CiiNamespace } from './cii-namespace.enum.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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