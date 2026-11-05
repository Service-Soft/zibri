/**
 * Permissions a stored role carries by a pattern: `'*'` for every permission of
 * the role's level, `'prefix.*'` for every one named below that prefix, such as `'invoices.*'` for
 * `invoices.read` and `invoices.export`.
 *
 * Matched against what the code declares, so a role carries a permission a release declares newly
 * without its row changing.
 */
export type PermissionWildcard = '*' | `${string}.*`;