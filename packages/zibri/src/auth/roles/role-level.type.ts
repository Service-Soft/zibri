/**
 * Where a role is held: by a user's membership in a tenant, or by the user, whichever tenant a
 * request is for.
 */
export type RoleLevel = 'tenant' | 'platform';