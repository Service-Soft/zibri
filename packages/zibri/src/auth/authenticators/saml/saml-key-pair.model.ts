/**
 * A private key of the application and the certificate that publishes its public key, both PEM encoded.
 */
export type SamlKeyPair = {
    /**
     * The private key.
     */
    privateKey: string,
    /**
     * The certificate of the public key, which the service provider metadata publishes.
     */
    certificate: string
};