/**
 * Who a logout request of a fake SAML identity provider logs out, as a user logging out at the
 * identity provider has it sent, and what it gets wrong.
 */
export type FakeSamlLogoutOptions = {
    /**
     * The NameID of the user.
     */
    nameId: string,
    /**
     * The session to end. Every session of the user, when undefined.
     * @default undefined
     */
    sessionIndex?: string,
    /**
     * Whether to leave the request unsigned.
     * @default false
     */
    unsigned?: boolean,
    /**
     * Whether to sign it with a key that is not the provider's.
     * @default false
     */
    signedByAnotherKey?: boolean
};