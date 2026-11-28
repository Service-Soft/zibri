import { Property } from '../../entity/decorators/property.decorator';
import { type LocaleCode } from '../../localization/models/locale-code.model';
import { UserKindUtilities } from '../user/user-kind.utilities';
import { CurrentUserMembership } from './current-user-membership.model';
import { type UserKind } from './user-kind.type';

/**
 * What `GET /me` of the `AuthController` answers: the logged in user, and what they may do in every
 * tenant they are a member of. A frontend shows and hides its parts by the permissions, the same ones
 * the routes check, and keeps them when its user switches tenants.
 */
export class CurrentUserProfile {
    /**
     * The id of the user.
     */
    @Property.string()
    id!: string;

    /**
     * The email of the user.
     */
    @Property.string()
    email!: string;

    /**
     * Whether the user is a person or a service account, which calls with an API key. The `AuthController`
     * always answers it. Undefined, in a profile an application answers itself, means `'person'`.
     */
    // TODO 4.0: required. Optional until then, so that a profile a route of 3.2 builds itself stays one
    @Property.string({ enum: UserKindUtilities.KINDS, required: false })
    kind?: UserKind;

    /**
     * When the user proved that `email` is theirs. Undefined while they have not.
     */
    @Property.date({ required: false })
    emailVerifiedAt?: Date;

    /**
     * The locale the mails of the framework reach the user in. Undefined for the default locale.
     */
    @Property.string({ required: false })
    locale?: LocaleCode;

    /**
     * The active memberships of the user, each with the permissions its roles carry in its tenant,
     * which \@Auth.hasPermission checks in a request for it. Only the tenant a credential is bound to,
     * such as that of an api key.
     */
    @Property.array({ items: { type: 'object', cls: () => CurrentUserMembership } })
    memberships!: CurrentUserMembership[];

    /**
     * The permissions the user's own roles carry, which \@Auth.hasPlatformPermission checks, as far as
     * the credential of the request may use them.
     */
    @Property.array({ items: { type: 'string' } })
    platformPermissions!: string[];
}