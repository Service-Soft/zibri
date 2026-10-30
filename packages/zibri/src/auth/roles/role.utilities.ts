import { BaseRole } from './base-role.model';
import { PermissionWildcard } from './permission-wildcard.type';
import { RoleIndex } from './role-index.model';
import { RoleLevel } from './role-level.type';
import { TenantRoleIndex } from './tenant-role-index.model';
import { ArrayWhereFilter } from '../../data-source/models/where/array-where-filter.model';

/**
 * Utilities for the roles of an application.
 */
export abstract class RoleUtilities {
    /**
     * Indexes the roles every tenant shares for the questions a check asks, each wildcard expanded
     * into the permissions it matches.
     * @param roles - Every role every tenant shares.
     * @param declared - The permissions declared in code, by level.
     * @returns The roles, indexed.
     */
    static resolveRoleIndex(roles: BaseRole[], declared: Readonly<Record<RoleLevel, ReadonlySet<string>>>): RoleIndex {
        const levels: Map<string, RoleLevel> = new Map();
        const permissionsByRole: Record<RoleLevel, Map<string, string[]>> = { tenant: new Map(), platform: new Map() };
        for (const role of roles) {
            levels.set(role.name, role.level);
            permissionsByRole[role.level].set(role.name, this.expandPermissions(role.permissions, declared[role.level]));
        }
        return { levels, permissionsByRole };
    }

    /**
     * Indexes the roles of one tenant's own, each wildcard expanded into the permissions it matches.
     * @param roles - Every role of the tenant's own.
     * @param declared - The tenant permissions declared in code.
     * @returns The roles, indexed.
     */
    static resolveTenantRoleIndex(roles: BaseRole[], declared: ReadonlySet<string>): TenantRoleIndex {
        return Object.fromEntries(roles.map(role => [role.name, this.expandPermissions(role.permissions, declared)]));
    }

    /**
     * Whether a permission a role carries is a wildcard.
     * @param permission - The permission.
     * @returns Whether it is `'*'` or ends in `'.*'`.
     */
    static isWildcard(permission: string): permission is PermissionWildcard {
        return permission === '*' || permission.endsWith('.*');
    }

    /**
     * Expands the wildcards among the permissions of a role into the declared permissions they match,
     * each permission once.
     * @param permissions - What the role carries.
     * @param declared - The permissions declared at the level of the role.
     * @returns The permissions. A wildcard matching nothing stays as it is.
     */
    static expandPermissions(permissions: readonly string[], declared: ReadonlySet<string>): string[] {
        const expanded: Set<string> = new Set();
        for (const permission of permissions) {
            const matched: string[] = this.isWildcard(permission) ? this.findMatching(permission, declared) : [permission];
            // kept rather than dropped: no check passes on it, and what checks the stored roles names it
            // like a permission the code stopped declaring
            for (const match of matched.length ? matched : [permission]) {
                expanded.add(match);
            }
        }
        return [...expanded];
    }

    /**
     * Finds the declared permissions a wildcard matches.
     * @param wildcard - The wildcard.
     * @param declared - The permissions declared at its level.
     * @returns The permissions it matches.
     */
    private static findMatching(wildcard: PermissionWildcard, declared: ReadonlySet<string>): string[] {
        if (wildcard === '*') {
            return [...declared];
        }
        // with the dot, so that 'invoices.*' matches below 'invoices' and nothing named 'invoices-old'
        const prefix: string = wildcard.slice(0, -1);
        return [...declared].filter(permission => permission.startsWith(prefix));
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
     * Finds the roles a row of a user or a membership is written with.
     * @param row - What is written, whatever it is typed as.
     * @returns The roles, undefined when the write leaves them alone.
     */
    static findWrittenRoles(row: object): string[] | undefined {
        const roles: unknown = Reflect.get(row, 'roles');
        return Array.isArray(roles) ? roles.filter(role => typeof role === 'string') : undefined;
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