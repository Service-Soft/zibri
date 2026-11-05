/**
 * An RSA key and a self signed certificate for it, both PEM encoded.
 */
export type FakeKeyPair = {
    /**
     * The private key, PKCS#8.
     */
    privateKey: string,
    /**
     * The certificate.
     */
    certificate: string
};