/**
 * A bind a fake directory was asked for.
 */
export type FakeLdapBind = {
    /**
     * The distinguished name that was bound as. Empty for an anonymous bind.
     */
    dn: string,
    /**
     * Whether a password came with it.
     */
    withPassword: boolean,
    /**
     * Whether the connection was encrypted when it was asked for.
     */
    encrypted: boolean,
    /**
     * Whether the directory took it.
     */
    succeeded: boolean
};