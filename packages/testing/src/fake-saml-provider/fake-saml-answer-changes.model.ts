/**
 * What the next answer of a fake SAML identity provider gets wrong, to see that a service provider
 * refuses it.
 */
export type FakeSamlAnswerChanges = {
    /**
     * The issuer the response and the assertion name, in place of the provider's entity id.
     */
    issuer?: string,
    /**
     * The audience the assertion is restricted to, in place of the service provider's entity id.
     */
    audience?: string,
    /**
     * Whether the response answers no request, the way a sign-in the provider starts on its own does.
     */
    unsolicited?: boolean,
    /**
     * When the assertion stops being valid, in place of five minutes from now.
     */
    notOnOrAfter?: Date,
    /**
     * Whether the assertion leaves out when the user signed in.
     */
    omitAuthnStatement?: boolean,
    /**
     * Whether nothing is signed.
     */
    unsigned?: boolean,
    /**
     * Whether the answer is signed with another key than the one the metadata names.
     */
    signedByAnotherKey?: boolean,
    /**
     * Changes the response after it is signed and before it is sent, to forge it.
     */
    tamper?: (xml: string) => string
};