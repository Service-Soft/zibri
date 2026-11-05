/**
 * The roles of one tenant's own, each with the permissions it carries. Plain data rather than a map,
 * so that what it takes in memory can be measured.
 */
export type TenantRoleIndex = Readonly<Record<string, readonly string[]>>;