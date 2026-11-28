import type { ChangeSetEntity } from '../../data-source/change-sets/models/change-set-entity.model';
import type { ChangeSetOnlyEntityClass } from '../../data-source/change-sets/models/change-set-only-entity-class.type';
import { isSoftDeleteEntityNewable } from '../../data-source/change-sets/models/is-soft-delete-entity.function';
import type { SoftDeleteEntity } from '../../data-source/change-sets/models/soft-delete-entity.model';
import { FrameworkColumnRegistry } from '../../data-source/migration/framework-column.registry';
import { whereFor } from '../../data-source/models/where/where-for.function';
import { USER_ENTITY } from '../../data-source/repository/repository-kind.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { Property } from '../../entity/decorators/property.decorator';
import { UniqueDeclaration } from '../../entity/models/unique-declaration.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { type LocaleCode } from '../../localization/models/locale-code.model';
import { Newable } from '../../types/newable.type';
import { UserKindUtilities } from '../user/user-kind.utilities';
import { SoftDeletingUserEntityOptions } from './soft-deleting-user-entity-options.model';
import { type UserKind } from './user-kind.type';

/**
 * Common properties shared by all users.
 */
export type BaseUser<Role extends string> = BaseEntity & {
    /**
     * The email of the user.
     */
    email: string,
    /**
     * The platform roles of the user, which \@Auth.hasPlatformRole checks. Each is one
     * `ZIBRI_DI_TOKENS.ROLES_AND_PERMISSIONS` declares at the platform level.
     */
    roles: Role[],
    /**
     * When the user was deactivated. A deactivated user cannot log in, and no request acts as them,
     * until they are reactivated. Undefined or null for an active user.
     */
    deactivatedAt?: Date | null,
    /**
     * When the user proved that `email` is theirs, by a link mailed to it. Undefined or null while
     * they have not.
     */
    emailVerifiedAt?: Date | null,
    /**
     * The locale the mails of the framework reach the user in, one the application supports. A user created
     * without one gets the locale of the request creating them. Undefined or null for the default locale.
     */
    locale?: LocaleCode | null,
    /**
     * Whether the user is a person, who logs in, or a service account, which acts through its API keys only and
     * never logs in. Set when the user is created, `'person'` by default, and never changed. Undefined or null for
     * a user stored before users had a kind, who is a person.
     */
    kind?: UserKind | null
};

/**
 * Defines a base user entity class, whose roles are typed as the given ones.
 *
 * Which roles a user may hold is what `ZIBRI_DI_TOKENS.ROLES_AND_PERMISSIONS` declares at the
 * platform level: writing any other is refused.
 */
export function BaseUserEntity<Role extends string = string>(): Newable<BaseUser<Role>>;

/**
 * Defines a base user entity class that soft deletes, whose roles are typed as the given ones.
 * @param base - `SoftDeleteEntity`, which the class extends.
 * @param options - Whether a soft deleted user keeps their email taken.
 */
export function BaseUserEntity<Role extends string = string>(
    base: typeof SoftDeleteEntity,
    options: SoftDeletingUserEntityOptions
): Newable<SoftDeleteEntity & BaseUser<Role>>;

/**
 * Defines a base user entity class that records its change sets, whose roles are typed as the given
 * ones.
 * @param base - `ChangeSetEntity`, which the class extends.
 */
export function BaseUserEntity<Role extends string = string>(base: ChangeSetOnlyEntityClass): Newable<ChangeSetEntity & BaseUser<Role>>;
export function BaseUserEntity<Role extends string = string>(
    base: typeof BaseEntity = BaseEntity,
    options?: SoftDeletingUserEntityOptions
): Newable<BaseUser<Role>> {
    // a soft deleted user is present and gone at once, so the address it holds is either free or not,
    // and only the application can say which. Asked of the type as well, for a caller without one
    const softDeletes: boolean = isSoftDeleteEntityNewable(base);
    if (softDeletes && options == undefined) {
        throw new InternalError(
            'A user entity that soft deletes has to say whether a deleted user keeps their email: pass { deletedUserKeepsEmail }.'
        );
    }
    const emailUnique: UniqueDeclaration = !softDeletes
        ? true
        : {
            where: options?.deletedUserKeepsEmail === true
                ? whereFor<SoftDeleteEntity>({})
                : whereFor<SoftDeleteEntity>({ deleted: false })
        };

    // eslint-disable-next-line jsdoc/require-jsdoc
    class Temp extends base implements BaseUser<Role> {
        // eslint-disable-next-line jsdoc/require-jsdoc
        static readonly [USER_ENTITY]: true = true;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ format: 'email', unique: emailUnique })
        email!: string;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.array({ items: { type: 'string' } })
        roles!: Role[];
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.date({ required: false })
        deactivatedAt?: Date | null;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.date({ required: false })
        emailVerifiedAt?: Date | null;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({
            required: false,
            // whatever route of the application creates the user: a sign up, an invitation, an administrator
            default: (_, context) => inject(ZIBRI_DI_TOKENS.LOCALIZE_SERVICE).resolveSupportedLocale(context)
        })
        locale?: LocaleCode | null;
        // eslint-disable-next-line jsdoc/require-jsdoc
        @Property.string({ enum: UserKindUtilities.KINDS, required: false, default: 'person' })
        kind?: UserKind | null;
    }
    // added by the data source to a table that lacks them, so that a user entity of 3.2 takes no migration of the
    // application's. Every user stored before users had a kind is a person. Without the column, a locale a user is
    // created with by default is left out, as a user of 3.2 had none, and updateLocale refuses one given
    FrameworkColumnRegistry.register(
        { entity: Temp, property: 'locale', meansAbsent: () => true },
        { entity: Temp, property: 'kind', storedValue: () => 'person', meansAbsent: value => value === 'person' }
    );

    return Temp;
}

/**
 * Checks whether or not the given value is a base user.
 * @param value - The value to check.
 * @returns True if the value has "id", "email" and "roles" keys, false otherwise.
 */
export function isBaseUser(value: unknown): value is BaseUser<string> {
    return (
        value != undefined
        && typeof value === 'object'
        && 'id' in value
        && 'email' in value
        && 'roles' in value
    );
}