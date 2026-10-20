import { Property } from '../../../entity/decorators/property.decorator.ts';

/**
 * What a device answers when it creates a passkey, each binary part base64url encoded.
 */
export class PasskeyAttestation {
    /**
     * What the browser says it asked the device for: the challenge, the origin and the ceremony.
     */
    @Property.string()
    clientDataJSON!: string;

    /**
     * The new passkey's public key and id, and the device's statement about itself.
     */
    @Property.string()
    attestationObject!: string;

    /**
     * The authenticator data on its own, which is also part of the attestation object.
     */
    @Property.string({ required: false })
    authenticatorData?: string;

    /**
     * How the browser can reach the device again, such as `internal`, `usb` or `hybrid`.
     */
    @Property.array({ items: { type: 'string' }, required: false })
    transports?: string[];

    /**
     * The algorithm of the new passkey's public key.
     */
    @Property.number({ format: 'integer', required: false })
    publicKeyAlgorithm?: number;

    /**
     * The new passkey's public key on its own, which is also part of the attestation object.
     */
    @Property.string({ required: false })
    publicKey?: string;
}