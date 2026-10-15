import { FakeKeyPair } from './fake-key-pair.model';

/**
 * What kind of certificate a fake key pair gets.
 */
export type FakeKeyPairOptions = {
    /**
     * The host names and ip addresses the certificate is valid for, as the one of a TLS server.
     * @default []
     */
    hosts?: string[],
    /**
     * Whether the certificate is one of an authority, which signs other certificates.
     * @default false
     */
    authority?: boolean,
    /**
     * The authority that signs the certificate, made with `authority: true`. Self signed, when undefined.
     * @default undefined
     */
    issuer?: FakeKeyPair,
    /**
     * When the certificate starts being valid.
     * @default a day ago
     */
    notBefore?: Date,
    /**
     * When the certificate stops being valid.
     * @default a year from now
     */
    notAfter?: Date
};