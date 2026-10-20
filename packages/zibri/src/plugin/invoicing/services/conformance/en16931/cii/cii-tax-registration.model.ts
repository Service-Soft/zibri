import { CiiNamespace } from './cii-namespace.enum.ts';
import { CiiSchemedId } from './cii-schemed-id.model.ts';
import { Property } from '../../../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../../../parsing/xml/xml-element.decorator.ts';
import { XmlNamespace } from '../../../../../../parsing/xml/xml-namespace.decorator.ts';

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