import { RoleLevel } from './role-level.type';

/**
 * The roles every tenant shares, indexed for the questions a check asks.
 */
export type RoleIndex = {
    /**
     * The level of every role.
     */
    readonly levels: ReadonlyMap<string, RoleLevel>,
    /**
     * The permissions each role of each level carries.
     */
    readonly permissionsByRole: Record<RoleLevel, ReadonlyMap<string, string[]>>
};