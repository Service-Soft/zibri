import { Property } from '../../entity/decorators/property.decorator.ts';

/**
 * What an introspected token is bound to: a client certificate, a DPoP key, or both.
 */
export class IntrospectedConfirmation {
    /**
     * The SHA-256 thumbprint of the certificate, base64url encoded.
     */
    @Property.string({ required: false })
    'x5t#S256'?: string;

    /**
     * The RFC 7638 thumbprint of the key the DPoP proofs are signed with.
     */
    @Property.string({ required: false })
    jkt?: string;
}