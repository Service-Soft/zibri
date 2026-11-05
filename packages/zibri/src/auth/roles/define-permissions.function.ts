import { type Permission } from './permission.type';
import { type PlatformPermission } from './platform-permission.type';
import { InternalError } from '../../error-handling/internal-error.model';

/**
 * Replaces every occurrence of a string in another.
 */
type ReplaceAll<Text extends string, From extends string, To extends string> = Text extends `${infer Head}${From}${infer Tail}`
    ? `${Head}${To}${ReplaceAll<Tail, From, To>}`
    : Text;

/**
 * The key a permission is named by in the object `definePermissions` and `definePlatformPermissions`
 * return: upper case, with every `.` and `-` turned into `_`, eg. `INVOICES_READ` for `invoices.read`.
 */
export type PermissionKey<Value extends string> = Uppercase<ReplaceAll<ReplaceAll<Value, '.', '_'>, '-', '_'>>;

/**
 * The tenant permissions `definePermissions` returns, each by its {@link PermissionKey}.
 */
export type DefinedPermissions<Values extends readonly string[]> = {
    readonly [Value in Values[number] as PermissionKey<Value>]: Permission<Value>
};

/**
 * The platform permissions `definePlatformPermissions` returns, each by its {@link PermissionKey}.
 */
export type DefinedPlatformPermissions<Values extends readonly string[]> = {
    readonly [Value in Values[number] as PermissionKey<Value>]: PlatformPermission<Value>
};

/**
 * Defines the tenant permissions of an application, as an object to name them by like an enum.
 *
 * ```ts
 * export const Permissions = definePermissions([...ZIBRI_PERMISSIONS, 'invoices.read'] as const);
 *
 * \@Auth.hasPermission(Permissions.INVOICES_READ)
 * ```
 * @param values - The permissions, `as const` so that each is known by name.
 * @returns Each permission by its {@link PermissionKey}.
 * @throws An InternalError when a permission is listed twice, two of them have the same key, or one
 * holds a `*`.
 */
export function definePermissions<const Values extends readonly string[]>(values: Values): DefinedPermissions<Values> {
    // the one cast that may produce a Permission. The mark says the value was defined as a tenant
    // permission, and this is the only place that can know it was
    return keyByPermission(values) as DefinedPermissions<Values>;
}

/**
 * Defines the platform permissions of an application, as an object to name them by like an enum.
 *
 * ```ts
 * export const PlatformPermissions = definePlatformPermissions([...ZIBRI_PLATFORM_PERMISSIONS, 'tenants.create'] as const);
 *
 * \@Auth.hasPlatformPermission(PlatformPermissions.TENANTS_CREATE)
 * ```
 * @param values - The permissions, `as const` so that each is known by name.
 * @returns Each permission by its {@link PermissionKey}.
 * @throws An InternalError when a permission is listed twice, two of them have the same key, or one
 * holds a `*`.
 */
export function definePlatformPermissions<const Values extends readonly string[]>(values: Values): DefinedPlatformPermissions<Values> {
    // the one cast that may produce a PlatformPermission, for the reason definePermissions gives
    return keyByPermission(values) as DefinedPlatformPermissions<Values>;
}

/**
 * Keys permissions the way {@link PermissionKey} does.
 * @param values - The permissions.
 * @returns Each permission by its key.
 * @throws An InternalError when a permission is listed twice, two of them have the same key, or one
 * holds a `*`.
 */
function keyByPermission(values: readonly string[]): Readonly<Record<string, string>> {
    const keyed: Record<string, string> = {};
    for (const value of values) {
        // a role names permissions by a pattern with it, which a permission named so would make ambiguous
        if (value.includes('*')) {
            throw new InternalError(`The permission '${value}' holds a '*', which a role uses to name permissions by a wildcard.`);
        }
        const key: string = value.replaceAll(/[.-]/g, '_').toUpperCase();
        if (key in keyed) {
            throw new InternalError(keyed[key] === value
                ? `The permission '${value}' is defined more than once.`
                : `The permissions '${keyed[key]}' and '${value}' would both be named ${key}.`);
        }
        keyed[key] = value;
    }
    return Object.freeze(keyed);
}