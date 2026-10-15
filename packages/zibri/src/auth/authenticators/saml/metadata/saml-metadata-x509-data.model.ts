import { Property } from '../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../parsing/xml/xml-element.decorator';

/**
 * The certificates of a key a SAML metadata document names.
 */
export class SamlMetadataX509Data {
    /**
     * The certificates, base64 encoded DER.
     */
    @XmlElement('X509Certificate')
    @Property.array({ items: { type: 'string' } })
    certificates!: string[];
}