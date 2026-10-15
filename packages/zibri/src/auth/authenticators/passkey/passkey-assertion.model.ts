import { Property } from '../../../entity/decorators/property.decorator';

/**
 * What a device answers when a passkey is used, each binary part base64url encoded.
 */
export class PasskeyAssertion {
    /**
     * What the browser says it asked the device for: the challenge, the origin and the ceremony.
     */
    @Property.string()
    clientDataJSON!: string;

    /**
     * What the device says about itself: the site it signed for, whether the user was verified, and its
     * signature counter.
     */
    @Property.string()
    authenticatorData!: string;

    /**
     * The device's signature over the authenticator data and the client data.
     */
    @Property.string()
    signature!: string;

    /**
     * The account the passkey was created for, as the device keeps it.
     */
    @Property.string({ required: false })
    userHandle?: string;
}