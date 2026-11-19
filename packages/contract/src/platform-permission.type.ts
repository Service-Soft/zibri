/**
 * Marks a string as a platform permission.
 *
 * Declared and never assigned, so it exists only in the types: the values carrying it are the ones
 * `definePlatformPermissions` returns, which is what makes going through it the only way to name one.
 */
declare const platformPermission: unique symbol;

/**
 * A platform permission of the application: what a platform role carries,
 * `@Auth.hasPlatformPermission` names and a user holds through the roles of their own.
 *
 * Made by `definePlatformPermissions`, so that a tenant permission or a misspelled string is refused
 * by the compiler wherever a platform permission is asked for.
 */
export type PlatformPermission<Value extends string = string> = Value & {
    /**
     * Present in the type and in no value.
     */
    readonly [platformPermission]: true
};