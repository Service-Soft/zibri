/**
 * Marks a string as a tenant permission.
 *
 * Declared and never assigned, so it exists only in the types: the values carrying it are the ones
 * `definePermissions` returns, which is what makes going through it the only way to name one.
 */
declare const tenantPermission: unique symbol;

/**
 * A tenant permission of the application: what a tenant role carries, `@Auth.hasPermission` names
 * and a request holds through its membership in the tenant it acts in.
 *
 * Made by `definePermissions`, so that a platform permission or a misspelled string is refused by
 * the compiler wherever a tenant permission is asked for.
 */
export type Permission<Value extends string = string> = Value & {
    /**
     * Present in the type and in no value.
     */
    readonly [tenantPermission]: true
};