import { type RoleServiceInterface } from '../../auth/roles/role-service.interface';
import { RoleUtilities } from '../../auth/roles/role.utilities';
import { EntityWriteObserver, ObservedWrite, RowWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type TenantServiceInterface } from '../tenant-service.interface';

/**
 * Refuses every write giving a membership a role it cannot hold in its tenant.
 */
export class MembershipWriteObserver implements EntityWriteObserver {
    // the tenant a membership belongs to, of a write to every membership a filter matches
    readonly properties: string[] = ['tenantId'];

    constructor(private readonly tenantService: TenantServiceInterface) {}

    private get roleService(): RoleServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
    }

    /**
     * Refuses the roles a write gives memberships, in the tenant of each.
     * @param write - The write.
     * @throws A BadRequestError naming the first role refused.
     */
    async validateWrite(write: ObservedWrite): Promise<void> {
        if (!write.data.some(row => RoleUtilities.findWrittenRoles(row) != undefined)) {
            return;
        }
        // a membership holds the roles of its tenant: the one a row names, or the one the write is
        // narrowed to, or, across tenants, each one a row it changes belongs to
        const active: string | undefined = this.tenantService.getActiveTenantId();
        const writes: RowWrite[] = active == undefined && write.data.some(row => typeof Reflect.get(row, 'tenantId') !== 'string')
            ? await write.resolveRowWrites()
            : write.data.map(row => ({ data: row, existing: undefined }));
        for (const { data, existing } of writes) {
            const roles: string[] | undefined = data == undefined ? undefined : RoleUtilities.findWrittenRoles(data);
            const tenantId: string | undefined = this.findTenant(data) ?? this.findTenant(existing) ?? active;
            if (roles != undefined && tenantId != undefined) {
                await this.roleService.validateRoles(roles, tenantId, write.transaction);
            }
        }
    }

    /**
     * Finds the tenant a row names.
     * @param row - The row, if any.
     * @returns The tenant, undefined when it names none.
     */
    private findTenant(row: object | undefined): string | undefined {
        const tenantId: unknown = row == undefined ? undefined : Reflect.get(row, 'tenantId');
        return typeof tenantId === 'string' ? tenantId : undefined;
    }
}
