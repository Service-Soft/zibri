import { SamlMetadataIdpSsoDescriptor } from './saml-metadata-idp-sso-descriptor.model';
import { Property } from '../../../../entity/decorators/property.decorator';
import { XmlAttribute } from '../../../../parsing/xml/xml-attribute.decorator';
import { XmlElement } from '../../../../parsing/xml/xml-element.decorator';
import { XmlRoot } from '../../../../parsing/xml/xml-root.decorator';

/**
 * The SAML metadata document an identity provider publishes about itself.
 */
@XmlRoot({ name: 'EntityDescriptor', namespace: 'urn:oasis:names:tc:SAML:2.0:metadata' })
export class SamlMetadataEntityDescriptor {
    /**
     * The entity id of the identity provider, which its answers name as their issuer.
     */
    @XmlAttribute('entityID')
    @Property.string()
    entityId!: string;

    /**
     * What the document says about the identity provider. Left out by a document describing something else.
     */
    @XmlElement('IDPSSODescriptor')
    @Property.object({ cls: () => SamlMetadataIdpSsoDescriptor, allowAdditionalProperties: true, required: false })
    identityProvider?: SamlMetadataIdpSsoDescriptor;
}