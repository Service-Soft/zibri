import { FakeKeyPair } from './fake-key-pair.model';
import { FakeKeyUsage } from './fake-key-usage.type';

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
    notAfter?: Date,
    /**
     * What the key of a certificate that is no authority may be used for. Without a key usage
     * extension, when undefined.
     * @default undefined
     */
    keyUsages?: FakeKeyUsage[],
    /**
     * The extended key usages of the certificate, as object identifiers, eg. `1.3.6.1.5.5.7.3.2` for
     * TLS client authentication. Without an extended key usage extension, when undefined.
     * @default undefined
     */
    extendedKeyUsages?: string[]
};