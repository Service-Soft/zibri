import { RoleIdentity } from './role-identity.model';
import { type RoleServiceInterface } from './role-service.interface';
import { RoleUtilities } from './role.utilities';
import { WrittenRole } from './written-role.model';
import { EntityWrite, EntityWriteObserver, ObservedWrite, WrittenRows } from '../../data-source/write-observers/entity-write-observer.model';

/**
 * Checks every write to the roles of an application, and has the role service read them again once it
 * is committed: refuses a role carrying a permission that is not declared, or named like a role it may
 * not be, and deleting, renaming or moving a role somebody holds.
 *
 * Every check reads the roles from memory, on every instance, so every way a role is written has to
 * reach them. The roles a write changes are followed as they were too, since a role can leave a
 * tenant as well as join one.
 */
export class RoleWriteObserver implements EntityWriteObserver {
    /**
     * What names a role and where it is held, of a write to every role a filter matches.
     */
    readonly properties: string[] = ['id', 'name', 'level', 'tenantId'];

    constructor(private readonly roleService: RoleServiceInterface) {}

    /**
     * Follows the roles as they were of every write that can change a stored one.
     * @param write - The write.
     * @returns False for an insert, whose roles were nowhere before.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation !== 'insert';
    }

    /**
     * Refuses role rows that cannot be written, and roles as the write leaves them where they cannot
     * be: renamed, moved to the other level or to another tenant, or deleted while somebody holds them,
     * since their holders would hold a name that no role is, which a role created with it later would
     * give back.
     * @param write - The write.
     * @throws A BadRequestError naming the first role refused.
     */
    async validateWrite(write: ObservedWrite): Promise<void> {
        this.roleService.validateRoleRows(write.data);
        const moved: RoleIdentity[] = [];
        const written: WrittenRole[] = [];
        for (const { data, existing } of await write.resolveRowWrites()) {
            const before: RoleIdentity | undefined = this.findIdentity(existing);
            if (data == undefined) {
                if (before != undefined) {
                    moved.push(before);
                }
                continue;
            }
            const renamed: boolean = ['name', 'level'].some(key => key in data && Reflect.get(data, key) !== this.findValue(existing, key))
                || ('tenantId' in data && this.findTenant(data) !== this.findTenant(existing));
            if (existing != undefined && !renamed) {
                continue;
            }
            if (before != undefined) {
                moved.push(before);
            }
            const after: WrittenRole | undefined = this.findWrittenRole(data, existing);
            if (after != undefined) {
                written.push(after);
            }
        }
        await this.roleService.validateRolesNotHeld(moved);
        await this.roleService.validateWrittenRoles(written, write.transaction);
    }

    /**
     * Tells the role service the tenants whose roles a write changed.
     * @param written - The roles as they were and as they are.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        await this.roleService.handleRolesChanged([...new Set([...written.before, ...written.after].map(row => this.findTenant(row)))]);
    }

    /**
     * Finds a role as a write leaves it.
     * @param data - What the write writes to it.
     * @param existing - The role as it is, undefined for one the write creates.
     * @returns The role, undefined for a name or level the role rows' own check or the store refuses.
     */
    private findWrittenRole(data: object, existing: object | undefined): WrittenRole | undefined {
        const name: unknown = 'name' in data ? data.name : this.findValue(existing, 'name');
        const level: unknown = 'level' in data ? data.level : this.findValue(existing, 'level');
        if (typeof name !== 'string' || !RoleUtilities.isRoleLevel(level)) {
            return undefined;
        }
        const id: unknown = this.findValue(existing, 'id') ?? Reflect.get(data, 'id');
        const tenantId: string | null = 'tenantId' in data ? this.findTenant(data) : this.findTenant(existing);
        return { id: typeof id === 'string' ? id : undefined, name, level, tenantId };
    }

    /**
     * Finds what names a stored role.
     * @param role - The role, if any.
     * @returns Its name and tenant, undefined when there is no role.
     */
    private findIdentity(role: object | undefined): RoleIdentity | undefined {
        const name: unknown = this.findValue(role, 'name');
        return typeof name === 'string' ? { name, tenantId: this.findTenant(role) } : undefined;
    }

    /**
     * Finds the tenant a role belongs to.
     * @param role - The role, if any.
     * @returns The tenant, null for a role every tenant shares.
     */
    private findTenant(role: object | undefined): string | null {
        const tenantId: unknown = this.findValue(role, 'tenantId');
        // eslint-disable-next-line unicorn/no-null
        return typeof tenantId === 'string' ? tenantId : null;
    }

    /**
     * Finds a value of a role, whatever it is typed as.
     * @param role - The role, if any.
     * @param key - The property.
     * @returns The value, undefined when there is no role.
     */
    private findValue(role: object | undefined, key: string): unknown {
        return role == undefined ? undefined : Reflect.get(role, key);
    }
}