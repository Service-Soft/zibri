import { EntityWriteObserver, ObservedWrite, RowWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { BadRequestError } from '../../error-handling/errors/bad-request.error';
import { $ts } from '../../localization/translate.function';
import { UserKindUtilities } from './user-kind.utilities';

/**
 * Refuses every write changing the kind of a user who exists: a person made a service account would lose their
 * logins, and a service account made a person could be given one.
 */
export class UserKindWriteObserver implements EntityWriteObserver {
    /**
     * The kind a user has, of a write to every user a filter matches.
     */
    readonly properties: string[] = ['kind'];

    /**
     * Refuses a write giving a stored user another kind.
     * @param write - The write.
     * @throws A BadRequestError when a row of it does.
     */
    async validateWrite(write: ObservedWrite): Promise<void> {
        // a user created with a kind has none to change
        if (write.operation === 'insert' || !write.data.some(row => 'kind' in row)) {
            return;
        }
        const writes: RowWrite[] = await write.resolveRowWrites();
        for (const { data, existing } of writes) {
            if (data == undefined || existing == undefined || !('kind' in data)) {
                continue;
            }
            // a user stored before users had a kind is a person, and writing that down changes nothing
            const existingKind: unknown = Reflect.get(existing, 'kind');
            if (UserKindUtilities.findKind(data) !== UserKindUtilities.findKind({ kind: existingKind })) {
                throw new BadRequestError($ts`The kind of a user is set when the user is created, and cannot be changed.`);
            }
        }
    }
}