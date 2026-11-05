/**
 * The type of credential a passkey is, which WebAuthn names in every answer.
 */
export enum PasskeyCredentialType {
    /**
     * A public key credential: the only kind there is.
     */
    PUBLIC_KEY = 'public-key'
}