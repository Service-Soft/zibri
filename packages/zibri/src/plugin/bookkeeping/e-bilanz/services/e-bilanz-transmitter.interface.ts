import { type EBilanzContent } from '../models/e-bilanz-content.model';

/**
 * The ELSTER certificate of a tenant a transmitter signs with: the `.pfx` file and its PIN.
 */
export type EBilanzCertificate = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly file: Buffer,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly pin: string
};

/**
 * How an E-Bilanz is sent: as a test, which the tax administration does not keep, or for real, with the certificate of
 * the tenant, and the `signal` that fires once the transmission took longer than `transmissionTimeoutInMs` of the
 * E-Bilanz options, after which nothing it answers is waited for.
 */
export type EBilanzTransmissionOptions = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly test: boolean,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly certificate: EBilanzCertificate,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly signal: AbortSignal
};

/**
 * What a transmission answers: whether it was accepted, its transfer ticket, the transmission protocol, and what the
 * tax administration answered, such as why it refused it.
 */
export type EBilanzTransmission = {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly succeeded: boolean,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly ticket: string | null,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly protocol: { readonly name: string, readonly mimeType: string, readonly data: Buffer } | null,
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly messages: readonly string[]
};

/**
 * Sends an E-Bilanz to the tax administration, such as through ERiC or another program. None is registered for you:
 * provide one with `E_BILANZ_TRANSMITTER_DI_VARIANT`, at most one. It is only ever called once for each request of a
 * person sending the E-Bilanz, in the background of the request, and never again for it.
 */
export interface EBilanzTransmitterInterface {
    /**
     * The name of the transmitter, which the records of its transmissions name.
     */
    readonly name: string,
    /**
     * Sends an E-Bilanz.
     * @param eBilanz - The content prepared.
     * @param options - Whether as a test, and the certificate.
     * @returns What the transmission answered, also when it was refused.
     * @throws An `EBilanzNotSentError` when it knows nothing reached the tax administration. Any other error records
     * the transmission as one that may have been sent.
     */
    transmit: (eBilanz: EBilanzContent, options: EBilanzTransmissionOptions) => Promise<EBilanzTransmission>
}