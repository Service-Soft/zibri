import { findUpsertRowOf, findUpsertTargets } from './find-upsert-targets.function';
import { ForwardingRepositoryDriver } from './forwarding.repository-driver';
import { DriverUpdateAllOptions, RepositoryDriverInterface } from './repository-driver.interface';
import { RoleIdentity } from '../../auth/roles/role-identity.model';
import { RoleLevel } from '../../auth/roles/role-level.type';
import { type RoleServiceInterface } from '../../auth/roles/role-service.interface';
import { RoleUtilities } from '../../auth/roles/role.utilities';
import { WrittenRole } from '../../auth/roles/written-role.model';
import { type UserServiceInterface } from '../../auth/user/user-service.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { BaseEntity } from '../../entity/base-entity.model';
import { type MembershipServiceInterface } from '../../tenancy/membership/membership-service.interface';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { DeepPartial } from '../../types/deep-partial.type';
import { Newable } from '../../types/newable.type';
import { RelatedNarrowing } from '../models/related-narrowing.model';
import { UpsertRow } from '../models/upsert-row.model';
import { Where } from '../models/where/where-filter.model';
import { Transaction } from '../transaction/transaction.model';

/**
 * What a write does to one row: what it writes, over the row as it is, if it is there.
 */
type RowWrite = {
    /**
     * What is written.
     */
    data: object,
    /**
     * The row as it is, undefined for one the write creates.
     */
    existing: object | undefined
};

/**
 * Reads a value of a row, whatever the row is typed as.
 * @param row - The row, if any.
 * @param key - The property.
 * @returns The value, undefined when the row does not carry it.
 */
function valueOf(row: object | undefined, key: string): unknown {
    if (row == undefined || !(key in row)) {
        return undefined;
    }
    const value: unknown = Reflect.get(row, key);
    return value;
}

/**
 * Reads the tenant a role belongs to.
 * @param row - The role, if any.
 * @returns The tenant, null for a role every tenant shares.
 */
function tenantOf(row: object | undefined): string | null {
    const tenantId: unknown = valueOf(row, 'tenantId');
    // eslint-disable-next-line unicorn/no-null
    return typeof tenantId === 'string' ? tenantId : null;
}

/**
 * Refuses a write giving a user or a membership a role it cannot hold, a role carrying a permission
 * that is not declared or named like a role it may not be, or deleting, renaming or moving a role
 * somebody holds, before anything is written.
 *
 * Here rather than in a save hook, which a repository can be given one of its own: every way a row is
 * written reaches the store through this seam, however the repository above it got there.
 *
 * Every write is checked, and nothing is for any other entity or for a write leaving the roles
 * alone; every read forwards.
 */
export class RoleValidatingRepositoryDriver<T extends BaseEntity> extends ForwardingRepositoryDriver<T> {
    constructor(
        inner: RepositoryDriverInterface<T>,
        private readonly entityClass: Newable<T>
    ) {
        super(inner);
    }

    private get roleService(): RoleServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
    }

    override async save(data: DeepPartial<T>[], transaction: Transaction | undefined, reload: boolean): Promise<T[]> {
        await this.validateWrite(data, transaction, async () => {
            const ids: string[] = data.flatMap(row => typeof row.id === 'string' ? [row.id] : []);
            const existing: T[] = ids.length ? await this.inner.find({ where: { id: { oneOf: ids } } as Where<T>, transaction }) : [];
            return data.map(row => ({ data: row, existing: existing.find(stored => stored.id === row.id) }));
        });
        return await super.save(data, transaction, reload);
    }

    override async insert(data: DeepPartial<T>[], transaction: Transaction | undefined): Promise<T[]> {
        // eslint-disable-next-line typescript/require-await
        await this.validateWrite(data, transaction, async () => data.map(row => ({ data: row, existing: undefined })));
        return await super.insert(data, transaction);
    }

    override async updateEach(
        rows: DeepPartial<T>[],
        where: Where<T>,
        transaction: Transaction | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        await this.validateWrite(rows, transaction, async () => (await this.inner.find({ where, transaction })).map(stored => ({
            // a row naming an id writes that row only, any other the rows the write matched
            data: rows
                .filter(row => row.id == undefined || row.id === stored.id)
                .reduce<object>((merged, row) => ({ ...merged, ...row }), {}),
            existing: stored
        })));
        return await super.updateEach(rows, where, transaction, related);
    }

    override async remove(ids: string[], transaction: Transaction | undefined): Promise<void> {
        if (ids.length && this.roleService.isRoleEntity(this.entityClass)) {
            // read first: a remove is handed ids, and who holds a role is known by its name
            const roles: T[] = await this.inner.find({ where: { id: { oneOf: ids } } as Where<T>, transaction });
            await this.roleService.validateRolesNotHeld(roles.flatMap(role => this.identityOf(role) ?? []));
        }
        await super.remove(ids, transaction);
    }

    override async updateAll<R extends boolean = false>(options: DriverUpdateAllOptions<T, R>): Promise<R extends true ? T[] : number> {
        await this.validateWrite(
            [options.data],
            options.transaction,
            async () => (await this.inner.find({ where: options.where, transaction: options.transaction }))
                .map(stored => ({ data: options.data, existing: stored }))
        );
        return await super.updateAll(options);
    }

    override async upsert(
        identity: string[],
        rows: UpsertRow<T>[],
        transaction: Transaction | undefined,
        reachable: Where<T> | undefined,
        related?: RelatedNarrowing
    ): Promise<T[]> {
        // what a row is inserted with, and what it is set to when it is already there
        await this.validateWrite(rows.flatMap(row => [row.create, this.setOnConflict(row)]), transaction, async () => {
            const targets: T[] = await findUpsertTargets(this.inner, identity, rows, transaction);
            return rows.map(row => {
                const existing: T | undefined = targets.find(stored => findUpsertRowOf(identity, rows, stored) === row);
                return existing == undefined ? { data: row.create, existing } : { data: this.setOnConflict(row), existing };
            });
        });
        return await super.upsert(identity, rows, transaction, reachable, related);
    }

    /**
     * Refuses a write that cannot be made: of the roles of the application, of the roles of a user,
     * or of the roles of a membership.
     * @param data - What is written, each row carrying `roles`, `level` or `permissions` only if it
     * writes them.
     * @param transaction - The transaction of the write, if any.
     * @param resolveWrites - Reads what the write does to each row, asked for only where it is needed.
     * @throws A BadRequestError naming what is wrong.
     */
    private async validateWrite(
        data: object[],
        transaction: Transaction | undefined,
        resolveWrites: () => Promise<RowWrite[]>
    ): Promise<void> {
        if (this.roleService.isRoleEntity(this.entityClass)) {
            this.roleService.validateRoleRows(data);
            await this.validateRoleWrites(await resolveWrites(), transaction);
            return;
        }
        const level: RoleLevel | undefined = this.resolveLevel();
        if (level == undefined || !data.some(row => Array.isArray(valueOf(row, 'roles')))) {
            return;
        }
        if (level === 'platform') {
            for (const row of data) {
                await this.roleService.validatePlatformRoles(this.rolesOf(row) ?? [], transaction);
            }
            return;
        }
        // a membership holds the roles of its tenant: the one a row names, or the one the write is
        // narrowed to, or, across tenants, each one a row it changes belongs to
        const active: string | undefined = inject<TenantServiceInterface>(ZIBRI_DI_TOKENS.TENANT_SERVICE).getActiveTenantId();
        const named: RowWrite[] = data.map(row => ({ data: row, existing: undefined }));
        const writes: RowWrite[] = active == undefined && data.some(row => typeof valueOf(row, 'tenantId') !== 'string')
            ? await resolveWrites()
            : named;
        for (const { data: row, existing } of writes) {
            const roles: string[] | undefined = this.rolesOf(row);
            const tenantId: string | undefined = tenantOf(row) ?? tenantOf(existing) ?? active;
            if (roles != undefined && tenantId != undefined) {
                await this.roleService.validateRoles(roles, tenantId, transaction);
            }
        }
    }

    /**
     * Refuses renaming a role, moving it to the other level or to another tenant while somebody holds
     * it, since its holders would hold a name that no role is, which a role created with it later
     * would give back; and refuses the roles as the write leaves them where they cannot be.
     * @param writes - What the write does to each row.
     * @param transaction - The transaction of the write, if any.
     * @throws A BadRequestError naming the first role refused.
     */
    private async validateRoleWrites(writes: RowWrite[], transaction: Transaction | undefined): Promise<void> {
        const moved: RoleIdentity[] = [];
        const written: WrittenRole[] = [];
        for (const { data, existing } of writes) {
            const renamed: boolean = ['name', 'level'].some(key => key in data && valueOf(data, key) !== valueOf(existing, key))
                || ('tenantId' in data && tenantOf(data) !== tenantOf(existing));
            if (existing != undefined && !renamed) {
                continue;
            }
            const before: RoleIdentity | undefined = this.identityOf(existing);
            if (before != undefined) {
                moved.push(before);
            }
            const after: WrittenRole | undefined = this.resolveWrittenRole(data, existing);
            if (after != undefined) {
                written.push(after);
            }
        }
        await this.roleService.validateRolesNotHeld(moved);
        await this.roleService.validateWrittenRoles(written, transaction);
    }

    /**
     * Resolves a role as a write leaves it.
     * @param data - What the write writes to it.
     * @param existing - The role as it is, undefined for one the write creates.
     * @returns The role, undefined for a name or level the role rows' own check or the store refuses.
     */
    private resolveWrittenRole(data: object, existing: object | undefined): WrittenRole | undefined {
        const name: unknown = 'name' in data ? valueOf(data, 'name') : valueOf(existing, 'name');
        const level: unknown = 'level' in data ? valueOf(data, 'level') : valueOf(existing, 'level');
        if (typeof name !== 'string' || !RoleUtilities.isRoleLevel(level)) {
            return undefined;
        }
        const id: unknown = valueOf(existing, 'id') ?? valueOf(data, 'id');
        const tenantId: string | null = 'tenantId' in data ? tenantOf(data) : tenantOf(existing);
        return { id: typeof id === 'string' ? id : undefined, name, level, tenantId };
    }

    /**
     * Reads what names a stored role.
     * @param role - The role, if any.
     * @returns Its name and tenant, undefined when there is no role.
     */
    private identityOf(role: object | undefined): RoleIdentity | undefined {
        const name: unknown = valueOf(role, 'name');
        return typeof name === 'string' ? { name, tenantId: tenantOf(role) } : undefined;
    }

    /**
     * Reads the roles a row of a user or membership is written with.
     * @param row - The row.
     * @returns The roles, undefined when the row leaves them alone.
     */
    private rolesOf(row: object): string[] | undefined {
        const roles: unknown = valueOf(row, 'roles');
        return Array.isArray(roles) ? roles.filter(role => typeof role === 'string') : undefined;
    }

    /**
     * Reads what an upsert sets on a row that is already there, of what is checked here.
     * @param row - The row of the upsert.
     * @returns What it sets of the roles, name, level, tenant and permissions, or nothing when it
     * leaves them alone.
     */
    private setOnConflict(row: UpsertRow<T>): object {
        const set: Record<string, unknown> = {};
        for (const [key, update] of Object.entries<unknown>(row.onConflict)) {
            const checked: boolean = ['roles', 'name', 'level', 'tenantId', 'permissions'].includes(key);
            if (checked && typeof update === 'object' && update != undefined && 'set' in update) {
                set[key] = update.set;
            }
        }
        return set;
    }

    /**
     * Which roles the rows of the entity hold.
     * @returns `'platform'` for users, `'tenant'` for memberships, undefined for anything else.
     */
    private resolveLevel(): RoleLevel | undefined {
        if (inject<UserServiceInterface>(ZIBRI_DI_TOKENS.USER_SERVICE).isUserEntity(this.entityClass)) {
            return 'platform';
        }
        if (inject<MembershipServiceInterface>(ZIBRI_DI_TOKENS.MEMBERSHIP_SERVICE).isMembershipEntity(this.entityClass)) {
            return 'tenant';
        }
        return undefined;
    }
}