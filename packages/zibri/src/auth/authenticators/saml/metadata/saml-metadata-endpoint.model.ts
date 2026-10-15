import { Property } from '../../../../entity/decorators/property.decorator';
import { XmlAttribute } from '../../../../parsing/xml/xml-attribute.decorator';

/**
 * An endpoint a SAML metadata document names, such as where an identity provider signs users in.
 */
export class SamlMetadataEndpoint {
    /**
     * How messages are sent to it, eg. `urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect`.
     */
    @XmlAttribute('Binding')
    @Property.string()
    binding!: string;

    /**
     * Its url.
     */
    @XmlAttribute('Location')
    @Property.string()
    location!: string;
}