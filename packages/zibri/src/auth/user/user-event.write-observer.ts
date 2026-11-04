import { EntityWrite, EntityWriteObserver, WrittenRows } from '../../data-source/write-observers/entity-write-observer.model';
import { type EventTypeFor } from '../../event/event-type-for.type';
import { FrameworkEventNames } from '../../event/framework-event-names.model';
import { FrameworkEventUtilities } from '../../event/framework-event.utilities';
import { type UserEventData } from '../../event/user-event-data.model';

/**
 * Emits the users a committed write deletes, deactivates or reactivates, as the events the application
 * named for them.
 */
export class UserEventWriteObserver implements EntityWriteObserver {
    /**
     * Which users, and whether they were deactivated, of a write to every user a filter matches.
     */
    readonly properties: string[] = ['id', 'deactivatedAt'];

    constructor(private readonly names: FrameworkEventNames) {}

    /**
     * Follows the users as they were of a removal, and of a change to when they were deactivated.
     * @param write - The write.
     * @returns True when an event the application named can come of it.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation === 'remove'
            ? this.names.userDeleted != undefined
            : write.operation !== 'insert' && this.isWritingDeactivation(write);
    }

    /**
     * Emits the users the write deleted, deactivated or reactivated.
     * @param written - The users as they were and as they are.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        if (written.operation === 'remove') {
            await this.emitDeleted(written.before);
            return;
        }
        if (written.operation === 'insert' || !this.isWritingDeactivation(written)) {
            return;
        }
        // a user is one row, so what it was is the row before with its id
        const wasDeactivated: Map<string, boolean> = new Map(written.before.flatMap(row => {
            const id: unknown = Reflect.get(row, 'id');
            return typeof id === 'string' ? [[id, Reflect.get(row, 'deactivatedAt') != undefined]] : [];
        }));
        for (const row of written.after) {
            const userId: unknown = Reflect.get(row, 'id');
            const isDeactivated: boolean = Reflect.get(row, 'deactivatedAt') != undefined;
            // a user created by the write was neither
            const was: boolean | undefined = typeof userId === 'string' ? wasDeactivated.get(userId) : undefined;
            if (typeof userId !== 'string' || was == undefined || was === isDeactivated) {
                continue;
            }
            const type: EventTypeFor<UserEventData> | undefined = isDeactivated ? this.names.userDeactivated : this.names.userReactivated;
            if (type != undefined) {
                await FrameworkEventUtilities.emit(type, { userId }, null);
            }
        }
    }

    /**
     * Emits the users a removal deleted, when the application named an event for it.
     * @param before - The users as they were.
     */
    private async emitDeleted(before: object[]): Promise<void> {
        const deleted: EventTypeFor<UserEventData> | undefined = this.names.userDeleted;
        if (deleted == undefined) {
            return;
        }
        for (const userId of this.findIds(before)) {
            await FrameworkEventUtilities.emit(deleted, { userId }, null);
        }
    }

    /**
     * Whether a write changes when users were deactivated, and the application named an event for it.
     * @param write - The write.
     * @returns True when it does.
     */
    private isWritingDeactivation(write: EntityWrite): boolean {
        return (this.names.userDeactivated != undefined || this.names.userReactivated != undefined)
            && write.data.some(row => 'deactivatedAt' in row);
    }

    /**
     * Finds the ids of some rows.
     * @param rows - The rows.
     * @returns Their ids.
     */
    private findIds(rows: object[]): string[] {
        return rows.flatMap(row => {
            const id: unknown = Reflect.get(row, 'id');
            return typeof id === 'string' ? [id] : [];
        });
    }
}