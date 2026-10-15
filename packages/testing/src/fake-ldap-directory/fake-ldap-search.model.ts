/**
 * A search a fake directory was asked for.
 */
export type FakeLdapSearch = {
    /**
     * Where it searched.
     */
    baseDn: string,
    /**
     * The filter, written the way RFC 4515 writes it.
     */
    filter: string,
    /**
     * Who the connection was bound as. Undefined when it was not bound with a password.
     */
    boundAs: string | undefined
};