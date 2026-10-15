/**
 * Who signs in at a fake provider, as its ID tokens say, or its api answers when it issues none.
 */
export type FakeOAuthIdentity = {
    /**
     * The `sub` claim.
     */
    subject: string,
    /**
     * The `email` claim.
     */
    email?: string,
    /**
     * The `email_verified` claim.
     */
    emailVerified?: boolean,
    /**
     * The `name` claim.
     */
    name?: string,
    /**
     * The `given_name` claim.
     */
    givenName?: string,
    /**
     * The `family_name` claim.
     */
    familyName?: string
};