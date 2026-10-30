import { EntityWriteObserver, ObservedWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { type RoleServiceInterface } from '../roles/role-service.interface';
import { RoleUtilities } from '../roles/role.utilities';

/**
 * Refuses every write giving a user a role they cannot hold: one that does not exist, or a tenant
 * role.
 */
export class UserWriteObserver implements EntityWriteObserver {
    /**
     * None: the roles a user is written with are all it checks.
     */
    readonly properties: string[] = [];

    constructor(private readonly roleService: RoleServiceInterface) {}

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