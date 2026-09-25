import { CiiNamespace } from './cii-namespace.enum';
import { CiiSchemedId } from './cii-schemed-id.model';
import { Property } from '../../../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator';

/**
 * A number a party is registered for tax under, eg. `VA` for a vat number or `FC` for a tax number.
 */
@XmlNamespace(CiiNamespace.RAM)
export class CiiTaxRegistration {
    /**
     * The number, with the scheme it belongs to.
     */
    @XmlElement('ID')
    @Property.object({ cls: () => CiiSchemedId })
    id!: CiiSchemedId;
}