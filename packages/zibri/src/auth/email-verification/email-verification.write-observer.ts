import { EntityWriteObserver, ObservedWrite, RowWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { InternalError } from '../../error-handling/internal-error.model';

/**
 * Refuses every write changing the email of a user that does not say whether the new address is
 * verified, while addresses are verified. Otherwise the verification of the previous address would
 * stand for the new one.
 */
export class EmailVerificationWriteObserver implements EntityWriteObserver {
    /**
     * The address a user has, of a write to every user a filter matches.
     */
    readonly properties: string[] = ['email'];

    /**
     * Refuses a write changing an address without writing `emailVerifiedAt` beside it.
     * @param write - The write.
     * @throws An InternalError when a row of it does.
     */
    async validateWrite(write: ObservedWrite): Promise<void> {
        // a user created with an address has nothing verified to carry over
        if (write.operation === 'insert' || !write.data.some(row => 'email' in row && !('emailVerifiedAt' in row))) {
            return;
        }
        const writes: RowWrite[] = await write.resolveRowWrites();
        for (const { data, existing } of writes) {
            if (data == undefined || existing == undefined || 'emailVerifiedAt' in data) {
                continue;
            }
            const email: unknown = Reflect.get(data, 'email');
            if (email != undefined && email !== Reflect.get(existing, 'email')) {
                throw new InternalError([
                    'A write changes the email of a user without emailVerifiedAt.',
                    'Write emailVerifiedAt beside it: null while the new address is not verified, or when it was.'
                ]);
            }
        }
    }
}