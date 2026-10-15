import { SamlMetadataEndpoint } from './saml-metadata-endpoint.model';
import { SamlMetadataKeyDescriptor } from './saml-metadata-key-descriptor.model';
import { Property } from '../../../../entity/decorators/property.decorator';
import { XmlElement } from '../../../../parsing/xml/xml-element.decorator';

/**
 * What a SAML metadata document says about the identity provider it describes.
 */
export class SamlMetadataIdpSsoDescriptor {
    /**
     * The keys of the identity provider.
     */
    @XmlElement('KeyDescriptor')
    @Property.array({ items: { type: 'object', cls: () => SamlMetadataKeyDescriptor, allowAdditionalProperties: true }, required: false })
    keys?: SamlMetadataKeyDescriptor[];

    /**
     * Where the identity provider signs users out, one per binding.
     */
    @XmlElement('SingleLogoutService')
    @Property.array({ items: { type: 'object', cls: () => SamlMetadataEndpoint, allowAdditionalProperties: true }, required: false })
    logoutServices?: SamlMetadataEndpoint[];

    /**
     * Where the identity provider signs users in, one per binding.
     */
    @XmlElement('SingleSignOnService')
    @Property.array({ items: { type: 'object', cls: () => SamlMetadataEndpoint, allowAdditionalProperties: true } })
    signInServices!: SamlMetadataEndpoint[];
}