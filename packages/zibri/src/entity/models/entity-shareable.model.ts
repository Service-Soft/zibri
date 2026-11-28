// every import here is type only, for the reason the scope model gives: this module is reached from `@Entity`
import { type AnyLevelPermissions } from '../../auth/models/any-level-permissions.model';
import { type Permission } from '../../auth/roles/permission.type';

/**
 * What an entity whose rows are shared with selected people declares, as `shareable` of `@Entity`.
 *
 * A caller whose membership carries `fullAccess` sees every row. Everybody else sees the rows shared with them, and
 * the descendants of those through `parent`.
 */
export type EntityShareable<TParentKey extends string = string> = {
    /**
     * What lets a caller see every row: a tenant permission, or a tenant and a platform permission either of which is
     * enough, answered as `@Auth.hasAnyLevelPermission` answers them.
     */
    fullAccess: Permission | AnyLevelPermissions,
    /**
     * The relation to the row of the same entity a row belongs to, a `manyToOne` or `belongsToOne`. A row shared with
     * somebody shares every row below it, to any depth. Undefined for rows shared one by one.
     */
    parent?: TParentKey,
    /**
     * The roles a share grants, from the least to the most, such as `['viewer', 'commenter', 'editor']`.
     */
    roles: readonly [string, ...string[]]
};
