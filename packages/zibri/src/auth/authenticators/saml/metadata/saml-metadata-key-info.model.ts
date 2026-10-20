import { SamlMetadataX509Data } from './saml-metadata-x509-data.model.ts';
import { Property } from '../../../../entity/decorators/property.decorator.ts';
import { XmlElement } from '../../../../parsing/xml/xml-element.decorator.ts';

/**
 * A key a SAML metadata document names, as an XML signature key info.
 */
export class SamlMetadataKeyInfo {
    /**
     * The certificates of the key. None for a key named some other way.
     */
    @XmlElement('X509Data')
    @Property.array({ items: { type: 'object', cls: () => SamlMetadataX509Data, allowAdditionalProperties: true }, required: false })
    x509Data?: SamlMetadataX509Data[];
}