/**
 * Which models of device may hold a passkey.
 *
 * Every device is asked to prove its model when a passkey is created, and its proof is checked against
 * what the FIDO Metadata Service publishes about the model. A device that proves nothing, or a model
 * not listed, cannot create one.
 */
export type PasskeyAttestationOptions = {
    /**
     * The models allowed, by their AAGUID, eg. `cb69481e-8ff7-4039-93ec-0a2729a154a8`.
     */
    allowedAaguids: string[],
    /**
     * Where the metadata is downloaded from.
     * @default 'https://mds3.fidoalliance.org/'
     */
    metadataServiceUrl?: string,
    /**
     * The certificates the metadata has to be signed under, PEM encoded.
     * @default the FIDO Alliance's root, GlobalSign Root CA - R3
     */
    metadataServiceRootCertificates?: string[]
};