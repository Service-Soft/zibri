import type { AttestationConveyancePreference,
    AttestationFormat,
    AuthenticationExtensionsClientInputs,
    AuthenticatorSelectionCriteria,
    PublicKeyCredentialDescriptorJSON,
    PublicKeyCredentialHint,
    PublicKeyCredentialParameters,
    PublicKeyCredentialRpEntity,
    PublicKeyCredentialUserEntityJSON } from '@simplewebauthn/server';

import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What the browser creates a passkey with, as `PublicKeyCredential.parseCreationOptionsFromJSON` or
 * `@simplewebauthn/browser`'s `startRegistration` take it.
 */
export class PasskeyCreationOptions {
    /**
     * The site the passkey is for.
     */
    @Property.unknown()
    rp!: PublicKeyCredentialRpEntity;

    /**
     * The account the passkey is for.
     */
    @Property.unknown()
    user!: PublicKeyCredentialUserEntityJSON;

    /**
     * The challenge the device signs, base64url encoded.
     */
    @Property.string()
    challenge!: string;

    /**
     * The algorithms the key may use, most preferred first.
     */
    @Property.unknown()
    pubKeyCredParams!: PublicKeyCredentialParameters[];

    /**
     * How long the user may take, in milliseconds.
     */
    @Property.number({ required: false })
    timeout?: number;

    /**
     * The passkeys the account has already, which a device holding one of them refuses to add again.
     */
    @Property.unknown({ required: false })
    excludeCredentials?: PublicKeyCredentialDescriptorJSON[];

    /**
     * What kind of device may create it.
     */
    @Property.unknown({ required: false })
    authenticatorSelection?: AuthenticatorSelectionCriteria;

    /**
     * Which kind of device the browser should suggest.
     */
    @Property.unknown({ required: false })
    hints?: PublicKeyCredentialHint[];

    /**
     * Whether the device is asked to prove its model.
     */
    @Property.unknown({ required: false })
    attestation?: AttestationConveyancePreference;

    /**
     * Which formats of proof are preferred.
     */
    @Property.unknown({ required: false })
    attestationFormats?: AttestationFormat[];

    /**
     * What the browser's extensions are asked for.
     */
    @Property.unknown({ required: false })
    extensions?: AuthenticationExtensionsClientInputs;
}