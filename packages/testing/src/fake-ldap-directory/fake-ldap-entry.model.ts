/**
 * An entry of a fake directory.
 */
export type FakeLdapEntry = {
    /**
     * The distinguished name of the entry, eg. `uid=anna,ou=people,dc=example,dc=com`.
     */
    dn: string,
    /**
     * The password a bind as the entry takes. A bind as an entry without one is refused.
     * @default undefined
     */
    password?: string,
    /**
     * How a bind as the account is refused, when it is disabled or locked, whatever the password: with
     * `invalidCredentials` like Active Directory, with `unwillingToPerform` like 389 Directory Server
     * for an inactivated account, or with `constraintViolation` like a lockout after too many tries.
     * Not refused, when undefined.
     * @default undefined
     */
    lockedWith?: 'invalidCredentials' | 'unwillingToPerform' | 'constraintViolation',
    /**
     * The attributes of the entry. An `entryUUID` is made up for an entry that has none, and is only
     * sent when a search asks for it by name.
     */
    attributes: Record<string, (string | Buffer)[]>
};