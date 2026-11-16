/**
 * The least an identity linked to a user holds.
 */
type IdentityWithId = {
    /**
     * The id of the identity.
     */
    id: string
};

/**
 * An identity linked to the user, as `GET /identities` lists it: an account at a provider, or a passkey.
 */
export type LinkedIdentity<Identity extends IdentityWithId = IdentityWithId> = {
    /**
     * The name of the authenticator it logs in through, like 'google' or 'passkey'.
     */
    authenticator: string,
    /**
     * The identity, as the authenticator stores it.
     */
    identity: Identity
};