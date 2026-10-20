import { SamlMetadataKeyInfo } from './saml-metadata-key-info.model.ts';
import { Property } from '../../../../entity/decorators/property.decorator.ts';
import { XmlAttribute } from '../../../../parsing/xml/xml-attribute.decorator.ts';
import { XmlElement } from '../../../../parsing/xml/xml-element.decorator.ts';

/**
 * A key of an identity provider, as its SAML metadata names it.
 */
export class SamlMetadataKeyDescriptor {
    /**
     * What the key is used for: `signing` or `encryption`. Both when left out.
     */
    @XmlAttribute('use')
    @Property.string({ required: false })
    use?: string;

    /**
     * The key.
     */
    @XmlElement('KeyInfo')
    @Property.object({ cls: () => SamlMetadataKeyInfo, allowAdditionalProperties: true })
    keyInfo!: SamlMetadataKeyInfo;
}