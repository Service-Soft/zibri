/**
 * A document an authenticator publishes about the application, for the provider to be set up with,
 * such as the metadata of a SAML service provider.
 */
export type FederatedMetadata = {
    /**
     * The document.
     */
    content: string,
    /**
     * Its mime type, eg. `application/samlmetadata+xml`.
     */
    mimeType: string
};