import { PasskeyAttachment } from './passkey-attachment.enum';
import { PasskeyAttestation } from './passkey-attestation.model';
import { PasskeyCredentialType } from './passkey-credential-type.enum';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What the browser answers once a device has created a passkey, as `PublicKeyCredential.toJSON()` or
 * `@simplewebauthn/browser`'s `startRegistration` give it.
 */
export class PasskeyRegistrationResponse {
    /**
     * The id of the new passkey, base64url encoded.
     */
    @Property.string()
    id!: string;

    /**
     * The same id.
     */
    @Property.string()
    rawId!: string;

    /**
     * What the device answered.
     */
    @Property.object({ cls: () => PasskeyAttestation })
    response!: PasskeyAttestation;

    /**
     * Where the device is.
     */
    @Property.string({ enum: PasskeyAttachment, required: false })
    authenticatorAttachment?: PasskeyAttachment;

    /**
     * What the browser's extensions answered.
     */
    @Property.unknown()
    clientExtensionResults!: Record<string, unknown>;

    /**
     * Always `public-key`.
     */
    @Property.string({ enum: PasskeyCredentialType })
    type!: PasskeyCredentialType;
}