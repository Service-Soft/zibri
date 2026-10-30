import { CredentialEntity } from '../../auth/strategies/credential-entity.model';
import { EntityWrite, EntityWriteObserver, WrittenRows } from '../../data-source/write-observers/entity-write-observer.model';

/**
 * Closes the connections whose login a write to the rows of a credential entity ended, once it is
 * committed: a session removed, or a token revoked.
 *
 * However the rows were written, so that a login ended by the application itself ends its sockets as
 * well as one ended by a logout.
 */
export class EndedLoginWriteObserver implements EntityWriteObserver {
    // whose the rows are, of a removal
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly properties: string[] = ['userId'];

    constructor(
        private readonly endedBy: CredentialEntity['endedBy'],
        private readonly disconnectEndedLogins: (userIds: string[]) => Promise<void>
    ) {}

    /**
     * Follows the rows a removal removes, of an entity whose rows end logins with them.
     * @param write - The write.
     * @returns True for a removal of such rows.
     */
    followsBefore(write: EntityWrite): boolean {
        return this.endedBy === 'remove' && write.operation === 'remove';
    }

    /**
     * Closes the connections of the users whose rows the write ended.
     * @param written - The rows as they were and as they are.
     */
    async handleWritten(written: WrittenRows): Promise<void> {
        if (written.operation !== this.endedBy) {
            return;
        }
        const ending: object[] = this.endedBy === 'remove' ? written.before : written.after;
        const userIds: Set<string> = new Set(ending.flatMap(row => {
            const userId: unknown = Reflect.get(row, 'userId');
            return typeof userId === 'string' ? [userId] : [];
        }));
        if (userIds.size) {
            await this.disconnectEndedLogins([...userIds]);
        }
    }
}