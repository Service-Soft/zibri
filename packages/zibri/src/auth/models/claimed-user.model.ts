import { type BaseUser } from './base-user.model';

/**
 * Who a credential says its caller is, read off the credential without a lookup: the id of the user
 * and the roles of their own the credential was issued with.
 */
export type ClaimedUser<Role extends string> = Pick<BaseUser<Role>, 'id' | 'roles'> & {
    /**
     * The roles of the user's active memberships, by tenant, as the credential was issued with them.
     * A check in a tenant reads them in place of the membership. Undefined for a credential carrying
     * none, whose memberships are read.
     */
    tenantRoles?: Readonly<Record<string, readonly string[]>>
};