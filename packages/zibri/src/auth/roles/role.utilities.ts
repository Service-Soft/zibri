import { BaseRole } from './base-role.model';
import { RoleIndex } from './role-index.model';
import { RoleLevel } from './role-level.type';
import { TenantRoleIndex } from './tenant-role-index.model';
import { ArrayWhereFilter } from '../../data-source/models/where/array-where-filter.model';

/**
 * Utilities for the roles of an application.
 */
export abstract class RoleUtilities {
    /**
     * Indexes the roles every tenant shares for the questions a check asks.
     * @param roles - Every role every tenant shares.
     * @returns The roles, indexed.
     */
    static resolveRoleIndex(roles: BaseRole[]): RoleIndex {
        const levels: Map<string, RoleLevel> = new Map();
        const permissionsByRole: Record<RoleLevel, Map<string, string[]>> = { tenant: new Map(), platform: new Map() };
        for (const role of roles) {
            levels.set(role.name, role.level);
            permissionsByRole[role.level].set(role.name, [...new Set<string>(role.permissions)]);
        }
        return { levels, permissionsByRole };
    }

    /**
     * Indexes the roles of one tenant's own.
     * @param roles - Every role of the tenant's own.
     * @returns The roles, indexed.
     */
    static resolveTenantRoleIndex(roles: BaseRole[]): TenantRoleIndex {
        return Object.fromEntries(roles.map(role => [role.name, [...new Set<string>(role.permissions)]]));
    }

    /**
     * Finds the permissions a role of a tenant's own carries.
     * @param index - The roles of the tenant's own.
     * @param role - The name of the role.
     * @returns The permissions, or undefined when the tenant has no role of its own by that name.
     */
    static findTenantRolePermissions(index: TenantRoleIndex, role: string): readonly string[] | undefined {
        // own keys only: a role named like something every object has is no role of the tenant
        return Object.hasOwn(index, role) ? index[role] : undefined;
    }

    /**
     * Whether a value is a level a role is held at.
     * @param value - The value.
     * @returns Whether it is `'tenant'` or `'platform'`.
     */
    static isRoleLevel(value: unknown): value is RoleLevel {
        return value === 'tenant' || value === 'platform';
    }

    /**
     * Collects the roles rows hold other than the known ones.
     * @param rows - The rows, ideally only those holding such a role.
     * @param known - The roles that exist everywhere.
     * @param findTenantRoles - Finds the roles that exist in the tenant of a row besides, for rows
     * belonging to a tenant.
     * @returns The other roles, each once.
     */
    static async resolveUnknownRoles(
        rows: AsyncIterable<unknown>,
        known: string[],
        findTenantRoles?: (tenantId: string) => Promise<string[]>
    ): Promise<string[]> {
        const knownRoles: Set<string> = new Set(known);
        const unknown: Set<string> = new Set();
        // read off each row rather than typed: the rows come from whichever repository a service was
        // given, and all that is known about them is that they hold roles
        for await (const row of rows) {
            const roles: unknown = this.valueOf(row, 'roles');
            const tenantId: unknown = this.valueOf(row, 'tenantId');
            const ofTenant: Set<string> = new Set(findTenantRoles != undefined && typeof tenantId === 'string'
                ? await findTenantRoles(tenantId)
                : []);
            for (const role of Array.isArray(roles) ? roles : []) {
                if (typeof role === 'string' && !knownRoles.has(role) && !ofTenant.has(role)) {
                    unknown.add(role);
                }
            }
        }
        return [...unknown];
    }

    /**
     * Reads a value of a row nothing more is known about.
     * @param row - The row.
     * @param key - The property.
     * @returns The value, undefined when the row is no object or does not carry it.
     */
    private static valueOf(row: unknown, key: string): unknown {
        if (typeof row !== 'object' || row == undefined || !(key in row)) {
            return undefined;
        }
        const value: unknown = Reflect.get(row, key);
        return value;
    }

    /**
     * The filter matching the rows that hold a role other than the known ones, so that a store hands
     * out only those.
     * @param known - The roles that exist.
     * @returns The filter on `roles`.
     */
    static whereHoldingUnknownRoles(known: string[]): ArrayWhereFilter<string> {
        // nothing known means any role at all, said without an empty list a store would have to turn
        // into sql
        return known.length ? { where: { notOneOf: known } } : { lengthGreaterThan: 0 };
    }
}