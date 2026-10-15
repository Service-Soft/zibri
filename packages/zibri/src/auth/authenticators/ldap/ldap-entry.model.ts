/**
 * The entry of a directory a user signed in as.
 */
export type LdapEntry = {
    /**
     * The distinguished name of the entry, which changes when the entry is moved or renamed.
     */
    dn: string,
    /**
     * The id the directory gave the entry, which never changes.
     */
    id: string,
    /**
     * The attributes that were read, by their name in lowercase. A value that is not text is base64 encoded.
     */
    attributes: Record<string, string[]>,
    /**
     * The distinguished names of the groups the entry is a member of, directly or through another
     * group, as the directory writes them. Empty when the authenticator reads no groups.
     */
    groups: string[]
};