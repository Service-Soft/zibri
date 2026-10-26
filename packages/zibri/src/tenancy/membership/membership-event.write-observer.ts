import { BaseMembership } from './base-membership.model';
import { type MembershipServiceInterface } from './membership-service.interface';
import { TenantUtilities } from '../../data-source/tenancy/tenant.utilities';
import { EntityWrite, EntityWriteObserver, WrittenRows } from '../../data-source/write-observers/entity-write-observer.model';
import { BaseEntity } from '../../entity/base-entity.model';
import { type EventTypeFor } from '../../event/event-type-for.type';
import { FrameworkEventNames } from '../../event/framework-event-names.model';
import { FrameworkEventUtilities } from '../../event/framework-event.utilities';
import { type MembershipEventData } from '../../event/membership-event-data.model';
import { Newable } from '../../types/newable.type';

/**
 * The memberships of one user in one tenant a write touched.
 */
type TouchedMembership = MembershipEventData & {
    /**
     * Whether one of them was active before the write.
     */
    wasActive: boolean,
    /**
     * The ids of the rows the write touched.
     */
    ids: Set<string>
};

/**
 * Emits the users a committed write makes active members of a tenant, or stops being one, as the
 * events the application named for them.
 */
export class MembershipEventWriteObserver implements EntityWriteObserver {
    // which memberships, whose and where, and whether they were active, of a write to every membership
    // a filter matches
    readonly properties: string[] = ['id', 'userId', 'tenantId', 'deactivatedAt'];

    constructor(
        private readonly entityClass: Newable<BaseEntity>,
        private readonly names: FrameworkEventNames,
        private readonly membershipService: MembershipServiceInterface
    ) {}

    /**
     * Follows the memberships as they were of every write that can change a stored one.
     * @param write - The write.
     * @returns False for an insert, whose rows were nobody's.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation !== 'insert';
    }

    /**
     * Emits each user and tenant whose active membership the write started or ended.
     * @param written - The memberships as they were and as they are.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        for (const touched of this.findTouched(written).values()) {
            // what is stored now rather than what the write did: a user may hold another membership
            // in the tenant the write did not touch, which keeps them a member, or made them one before
            const active: BaseMembership<string> | undefined = await this.membershipService.findActiveMembership(touched.userId, touched.tenantId);
            const type: EventTypeFor<MembershipEventData> | undefined = this.findEventType(touched, active);
            if (type != undefined) {
                await FrameworkEventUtilities.emit(type, { userId: touched.userId, tenantId: touched.tenantId }, touched.tenantId);
            }
        }
    }

    /**
     * Finds the event a write is to its user and tenant.
     * @param touched - The memberships of the user in the tenant the write touched.
     * @param active - Their active membership there now, if any.
     * @returns The type the application named for it, undefined when the write started or ended nothing.
     */
    private findEventType(touched: TouchedMembership, active: BaseMembership<string> | undefined): EventTypeFor<MembershipEventData> | undefined {
        if (active == undefined) {
            return touched.wasActive ? this.names.membershipEnded : undefined;
        }
        // one the write did not touch was active before it as well
        return !touched.wasActive && touched.ids.has(active.id) ? this.names.membershipStarted : undefined;
    }

    /**
     * Groups the rows a write touched by user and tenant.
     * @param written - The memberships as they were and as they are.
     * @returns Each user and tenant, by `userId:tenantId`.
     */
    private findTouched(written: WrittenRows): Map<string, TouchedMembership> {
        const touched: Map<string, TouchedMembership> = new Map();
        const touch: (row: object, wasActive: boolean) => void = (row, wasActive) => {
            const userId: unknown = Reflect.get(row, 'userId');
            const tenantId: string | undefined = TenantUtilities.resolveTenantOf(row, this.entityClass);
            const id: unknown = Reflect.get(row, 'id');
            if (typeof userId !== 'string' || tenantId == undefined) {
                return;
            }
            const key: string = `${userId}:${tenantId}`;
            const entry: TouchedMembership = touched.get(key) ?? { userId, tenantId, wasActive: false, ids: new Set() };
            if (typeof id === 'string') {
                entry.ids.add(id);
            }
            entry.wasActive ||= wasActive;
            touched.set(key, entry);
        };
        for (const row of written.before) {
            touch(row, this.isActive(row));
        }
        for (const row of written.after) {
            touch(row, false);
        }
        return touched;
    }

    /**
     * Whether a row is an active membership.
     * @param row - The row as it was.
     * @returns True when neither deactivated nor soft deleted.
     */
    private isActive(row: object): boolean {
        return Reflect.get(row, 'deactivatedAt') == undefined && Reflect.get(row, 'deletedAt') == undefined;
    }
}
