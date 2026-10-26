import { EntityWriteObserver, ObservedWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { type RoleServiceInterface } from '../roles/role-service.interface';
import { RoleUtilities } from '../roles/role.utilities';

/**
 * Refuses every write giving a user a role they cannot hold: one that does not exist, or a tenant
 * role.
 */
export class UserWriteObserver implements EntityWriteObserver {
    readonly properties: string[] = [];

    private get roleService(): RoleServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ROLE_SERVICE);
    }

    /**
     * Refuses the roles each row is written with.
     * @param write - The write.
     * @throws A BadRequestError naming the first role refused.
     */
    async validateWrite(write: ObservedWrite): Promise<void> {
        for (const row of write.data) {
            const roles: string[] | undefined = RoleUtilities.findWrittenRoles(row);
            if (roles != undefined) {
                await this.roleService.validatePlatformRoles(roles, write.transaction);
            }
        }
    }
}
