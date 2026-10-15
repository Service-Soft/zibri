/**
 * Which NameID a SAML identity provider is asked for, which names the user and links them to an
 * account. A transient one, new for every sign-in, could never find the user again, and is refused.
 */
export enum SamlNameIdFormat {
    /**
     * An opaque id that stays the same for the user at this application, whatever else changes.
     */
    PERSISTENT = 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
    /**
     * The user's email address. Changes when their email does, which links them to a new identity.
     */
    EMAIL_ADDRESS = 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
    /**
     * Whatever the identity provider is configured to send.
     */
    UNSPECIFIED = 'urn:oasis:names:tc:SAML:1.1:nameid-format:unspecified'
}