import type { MetadataBLOBPayloadEntry } from '@simplewebauthn/server';

/**
 * Interface for what reads the metadata a FIDO Metadata Service publishes about models of devices.
 */
export interface FidoMetadataServiceInterface {
    /**
     * Finds what the service at the given url publishes about a model, from a list that is signed under
     * one of the given roots.
     *
     * Throws when the list could not be downloaded, or is not signed under one of the roots.
     */
    findEntry: (url: string, rootCertificates: string[], aaguid: string) => Promise<MetadataBLOBPayloadEntry | undefined>
}