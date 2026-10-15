import type { AuthenticationExtensionsClientInputs,
    PublicKeyCredentialDescriptorJSON,
    PublicKeyCredentialHint,
    UserVerificationRequirement } from '@simplewebauthn/server';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What the browser uses a passkey with, as `PublicKeyCredential.parseRequestOptionsFromJSON` or
 * `@simplewebauthn/browser`'s `startAuthentication` take it.
 */
export class PasskeyRequestOptions {
    /**
     * The challenge the device signs, base64url encoded.
     */
    @Property.string()
    challenge!: string;

    /**
     * How long the user may take, in milliseconds.
     */
    @Property.number({ required: false })
    timeout?: number;

    /**
     * The site the passkey is for.
     */
    @Property.string({ required: false })
    rpId?: string;

    /**
     * The passkeys that may answer. Any passkey of the site the device holds, when there are none.
     */
    @Property.unknown({ required: false })
    allowCredentials?: PublicKeyCredentialDescriptorJSON[];

    /**
     * Whether the device has to verify its user.
     */
    @Property.unknown({ required: false })
    userVerification?: UserVerificationRequirement;

    /**
     * Which kind of device the browser should suggest.
     */
    @Property.unknown({ required: false })
    hints?: PublicKeyCredentialHint[];

    /**
     * What the browser's extensions are asked for.
     */
    @Property.unknown({ required: false })
    extensions?: AuthenticationExtensionsClientInputs;
}