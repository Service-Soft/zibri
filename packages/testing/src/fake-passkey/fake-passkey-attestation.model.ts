import { KeyObject } from 'node:crypto';

/**
 * What a device proves its model with when it creates a passkey: a key its maker put into it, and the
 * certificate of that key, issued for the model.
 */
export type FakePasskeyAttestation = {
    /**
     * The model of the device, which the certificate names.
     */
    aaguid: string,
    /**
     * Signs the attestation.
     */
    privateKey: KeyObject,
    /**
     * The DER encoded certificates, the one of the private key first.
     */
    certificates: Buffer[]
};