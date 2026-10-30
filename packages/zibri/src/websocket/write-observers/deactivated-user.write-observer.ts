import { EntityWrite, EntityWriteObserver, WrittenRows } from '../../data-source/write-observers/entity-write-observer.model';

/**
 * Closes the connections of users a write deactivates, once it is committed, however the users were
 * written.
 */
export class DeactivatedUserWriteObserver implements EntityWriteObserver {
    // which users, of a write to every user a filter matches
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly properties: string[] = ['id'];

    constructor(private readonly disconnectEndedLogins: (userIds: string[]) => Promise<void>) {}

    /**
     * Follows the users a write to every user a filter matches deactivates, since such a write hands
     * back no rows.
     * @param write - The write.
     * @returns True for such a write deactivating users.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation === 'updateAll' && this.isDeactivating(write);
    }

    /**
     * Closes the connections of the users the write deactivated.
     * @param written - The rows as they were and as they are.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        if (!this.isDeactivating(written)) {
            return;
        }
        const userIds: string[] = written.after.flatMap(row => {
            const id: unknown = Reflect.get(row, 'id');
            return typeof id === 'string' && Reflect.get(row, 'deactivatedAt') instanceof Date ? [id] : [];
        });
        if (userIds.length) {
            await this.disconnectEndedLogins(userIds);
        }
    }

    /**
     * Whether a write deactivates users.
     * @param write - The write.
     * @returns True when a row it writes holds when its user was deactivated.
     */
    private isDeactivating(write: EntityWrite): boolean {
        return write.data.some(row => Reflect.get(row, 'deactivatedAt') instanceof Date);
    }
}