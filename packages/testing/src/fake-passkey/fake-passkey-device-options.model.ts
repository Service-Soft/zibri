import { FakePasskeyAttestation } from './fake-passkey-attestation.model.ts';

/**
 * What kind of device a fake one is.
 */
export type FakePasskeyDeviceOptions = {
    /**
     * The model the device says it is. All zeros by default, which is what a device that keeps its
     * model to itself says. Taken from the attestation when there is one.
     */
    aaguid?: string,
    /**
     * What the device proves its model with, when asked to. None by default: it then answers with no
     * attestation at all, whatever it is asked.
     */
    attestation?: FakePasskeyAttestation,
    /**
     * Whether the device verifies its user, with a fingerprint or a PIN, before it creates or uses a
     * passkey. True by default, and settable on the device later.
     */
    verifiesUser?: boolean,
    /**
     * Whether the passkeys are synced to the user's other devices, the way a phone's password manager
     * keeps them. Such a device counts no signatures. False by default, which is a security key: it
     * counts every signature.
     */
    synced?: boolean,
    /**
     * Whether the device stores the passkeys it creates, so it can offer them at a sign-in that names
     * none. True by default. False is an older security key: it uses only a passkey the site names, and
     * refuses to create one when the site demands a stored one.
     */
    storesPasskeys?: boolean
};