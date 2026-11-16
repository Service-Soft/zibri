import { CurrentUserMembership } from './current-user-membership.model';

/**
 * The logged in user and what they may do, as `GET /me` answers it.
 */
export type CurrentUserProfile<Permission extends string = string, PlatformPermission extends string = string> = {
    /**
     * The id of the user.
     */
    id: string,
    /**
     * The email of the user.
     */
    email: string,
    /**
     * When the user verified their email, as an ISO string. Undefined while they haven't.
     */
    emailVerifiedAt?: string,
    /**
     * The tenants the user is a member of, with what they may do in each.
     */
    memberships: CurrentUserMembership<Permission>[],
    /**
     * What the user may do by their own roles, in every tenant.
     */
    platformPermissions: PlatformPermission[]
};