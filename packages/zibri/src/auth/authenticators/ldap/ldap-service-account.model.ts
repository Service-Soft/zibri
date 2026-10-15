/**
 * The account the application binds to a directory with, to find the entry a user signs in as.
 */
export type LdapServiceAccount = {
    /**
     * The distinguished name of the account, eg. `cn=zibri,ou=services,dc=example,dc=com`.
     */
    dn: string,
    /**
     * The password of the account.
     */
    password: string
};