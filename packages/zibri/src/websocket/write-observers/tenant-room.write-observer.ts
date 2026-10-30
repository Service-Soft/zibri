import { TenantUtilities } from '../../data-source/tenancy/tenant.utilities';
import { EntityWrite, EntityWriteObserver, WrittenRows } from '../../data-source/write-observers/entity-write-observer.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { ChangedMembership } from '../../tenancy/membership/changed-membership.model';
import { Newable } from '../../types/newable.type';

/**
 * Brings which tenants' broadcasts the connections of users receive in line with their memberships,
 * once a write to memberships is committed.
 *
 * However the memberships were written. Once committed, since following a write that is rolled back
 * would hand a user the broadcasts of a tenant they never joined.
 */
export class TenantRoomWriteObserver implements EntityWriteObserver {
    // whose memberships, and where, of a write to every membership a filter matches
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly properties: string[] = ['userId', 'tenantId'];

    constructor(
        private readonly entityClass: Newable<BaseEntity>,
        private readonly updateTenantRooms: (memberships: ChangedMembership[]) => Promise<void>
    ) {}

    /**
     * Follows the memberships as they were of every write that can take one from its user.
     * @param write - The write.
     * @returns False for an insert, whose rows were nobody's, and an upsert, which leaves the user it
     * meets a row by as it is.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation !== 'insert' && write.operation !== 'upsert';
    }

    /**
     * Moves the connections of the users of the written memberships.
     * @param written - The memberships as they were and as they are.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        const changed: Map<string, ChangedMembership> = new Map();
        for (const row of [...written.before, ...written.after]) {
            const userId: unknown = Reflect.get(row, 'userId');
            const tenantId: string | undefined = TenantUtilities.resolveTenantOf(row, this.entityClass);
            if (typeof userId === 'string' && tenantId != undefined) {
                changed.set(`${userId}:${tenantId}`, { userId, tenantId });
            }
        }
        if (changed.size) {
            await this.updateTenantRooms([...changed.values()]);
        }
    }
}