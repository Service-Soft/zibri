import { EntityWrite, EntityWriteObserver, WrittenRows } from '../../data-source/write-observers/entity-write-observer.model';
import { type EventTypeFor } from '../../event/event-type-for.type';
import { FrameworkEventUtilities } from '../../event/framework-event.utilities';
import { type RolesChangedEventData } from '../../event/roles-changed-event-data.model';

/**
 * Emits where the roles a committed write changed are held, as the event the application named for
 * it: once for each tenant whose own roles changed, and once for the roles every tenant shares.
 */
export class RoleEventWriteObserver implements EntityWriteObserver {
    // where a role is held, of a write to every role a filter matches
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly properties: string[] = ['tenantId'];

    constructor(private readonly type: EventTypeFor<RolesChangedEventData>) {}

    /**
     * Follows the roles as they were of every write that can change a stored one, since a role can
     * leave a tenant as well as join one.
     * @param write - The write.
     * @returns False for an insert, whose roles were nowhere before.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation !== 'insert';
    }

    /**
     * Emits each tenant the roles the write changed are held in.
     * @param written - The roles as they were and as they are.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        const tenantIds: Set<string | null> = new Set([...written.before, ...written.after].map(row => {
            const tenantId: unknown = Reflect.get(row, 'tenantId');
            return typeof tenantId === 'string' ? tenantId : null;
        }));
        for (const tenantId of tenantIds) {
            await FrameworkEventUtilities.emit(this.type, { tenantId }, tenantId);
        }
    }
}