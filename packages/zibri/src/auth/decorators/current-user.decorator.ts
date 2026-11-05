import { CurrentUserOptions } from './current-user-options.model';
import { OmitStrict } from '../../types/omit-strict.type';
import { MetadataUtilities } from '../../utilities/metadata.utilities';
import { type BaseUser } from '../models/base-user.model';
import { type Permission } from '../roles/permission.type';
import { type PlatformPermission } from '../roles/platform-permission.type';
import { AuthStrategies } from '../strategies/auth-strategies.model';

/**
 * The user a request is from, as a handler or a scope is handed it: who they are, and what the
 * request may do, instead of the roles they hold. Both lists are narrowed to what the credential of
 * the request may use.
 */
export type CurrentUser<UserType extends BaseUser<string> = BaseUser<string>> = OmitStrict<UserType, 'roles'> & {
    /**
     * The permissions the roles of the user's membership in the active tenant carry, which
     * \@Auth.hasPermission checks. Empty when no tenant is active.
     */
    permissions: Permission[],
    /**
     * The permissions the user's own roles carry, which \@Auth.hasPlatformPermission checks.
     */
    platformPermissions: PlatformPermission[]
};

/**
 * Metadata of the \@CurrentUser decorator.
 */
export type CurrentUserMetadata = {
    /**
     * The index at which the parameter exists that should be injected as the currently logged in user.
     */
    index: number,
    /**
     * Whether or not the injected user is required or not.
     * Defaults to true.
     */
    required: boolean,
    /**
     * The allowed auth strategies to resolve the currently logged in user. If not provided, any strategy is allowed.
     */
    allowedStrategies?: AuthStrategies
};

/**
 * Marks the parameter to be injected as the currently logged in user, a {@link CurrentUser}.
 * @param options - Whether the user is required, and which auth strategies may resolve them.
 */
// the type of the same name above is what it injects, one a value and the other a type, which
// typescript keeps apart: a parameter reads `@CurrentUser() user: CurrentUser<User>`
// eslint-disable-next-line typescript/no-redeclare
export function CurrentUser(options: CurrentUserOptions = {}): ParameterDecorator {
    return (target, propertyKey, index) => {
        const fullMetadata: CurrentUserMetadata = {
            required: options.required ?? true,
            index,
            allowedStrategies: options.authStrategies
        };
        const ctor: Function = target.constructor;
        MetadataUtilities.setFilePath(ctor);
        const key: string = propertyKey?.toString() ?? '';
        MetadataUtilities.setRouteCurrentUser(ctor, fullMetadata, key);
    };
}