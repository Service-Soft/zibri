import { PasskeyAttestationOptions } from './passkey-attestation-options.model';

/**
 * Where passkeys are used, and how they are created.
 */
export type PasskeyOptions = {
    /**
     * The domain passkeys are bound to, eg. `example.com`. A passkey works on this domain and every
     * subdomain of it, and on no other, whatever page asks. Changing it later orphans every passkey.
     */
    relyingPartyId: string,
    /**
     * The name a device shows the user when it creates a passkey, eg. `Example`.
     */
    relyingPartyName: string,
    /**
     * The origins of the pages passkeys are created and used on, eg. `https://app.example.com`. The
     * browser tells which page asked, and an answer from any other is refused.
     */
    origins: string[],
    /**
     * Which models of device may hold a passkey, proven with the attestation each device carries. Any
     * device by default, and none is asked to prove its model.
     */
    attestation?: PasskeyAttestationOptions,
    /**
     * How long a device may take to answer a challenge.
     * @default 300000
     */
    challengeExpiresInMs?: number,
    /**
     * How long the creation of a user may take after a passkey for them was created.
     * @default 1800000
     */
    registrationTicketExpiresInMs?: number
};