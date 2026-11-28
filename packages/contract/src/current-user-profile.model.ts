import { CurrentUserMembership } from './current-user-membership.model';
import { LocaleCode } from './locale-code.type';
import { UserKind } from './user-kind.type';

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
     * Whether the user is a person or a service account, which calls with an API key. Zibri always answers it.
     * Undefined, such as in a profile a test of a frontend builds, means `'person'`.
     */
    // TODO 4.0: required. Optional until then, so that a profile built for 3.2 stays one
    kind?: UserKind,
    /**
     * When the user verified their email, as an ISO string. Undefined while they haven't.
     */
    emailVerifiedAt?: string,
    /**
     * The locale the mails of the application reach the user in, such as `de`. Undefined for its default locale.
     */
    locale?: LocaleCode,
    /**
     * The tenants the user is a member of, with what they may do in each.
     */
    memberships: CurrentUserMembership<Permission>[],
    /**
     * What the user may do by their own roles, in every tenant.
     */
    platformPermissions: PlatformPermission[]
};