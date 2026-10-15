import { PasskeyAssertion } from './passkey-assertion.model';
import { PasskeyAttachment } from './passkey-attachment.enum';
import { PasskeyCredentialType } from './passkey-credential-type.enum';
import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What the browser answers once a device has used a passkey, as `PublicKeyCredential.toJSON()` or
 * `@simplewebauthn/browser`'s `startAuthentication` give it.
 */
export class PasskeyAuthenticationResponse {
    /**
     * The id of the passkey that was used, base64url encoded.
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
    @Property.object({ cls: () => PasskeyAssertion })
    response!: PasskeyAssertion;

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