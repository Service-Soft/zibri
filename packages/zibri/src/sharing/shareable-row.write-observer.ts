import { RestoreContextUtilities } from '../backup/restore-context.utilities';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { EntityWrite, EntityWriteObserver, MadeWrite, ObservedWrite, RowWrite } from '../data-source/write-observers/entity-write-observer.model';

/**
 * What the observer of a shareable entity asks of the share service.
 */
export type ShareableRowWriteHandlers = {
    /**
     * Validates that a row is not placed below itself or a row below it.
     */
    validateNotBelowItself: (rowId: string, parentId: string, transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Deletes the shares of rows removed.
     */
    deleteSharesOf: (rowIds: string[], transaction: RepositoryTransaction | undefined) => Promise<void>,
    /**
     * Forgets what the request found visible, as the write may change it.
     */
    forgetVisibleRows: () => void
};

/**
 * Keeps the rows of a shareable entity and their shares together: refuses a row placed below itself, deletes the
 * shares of a row removed in the transaction removing it, and has the request read what it sees anew after a write.
 */
export class ShareableRowWriteObserver implements EntityWriteObserver {
    /**
     * The id of a row, and the column its parent is held in, read before a row is updated or removed.
     */
    readonly properties: string[];

    constructor(
        private readonly parentColumn: string | undefined,
        private readonly handlers: ShareableRowWriteHandlers
    ) {
        this.properties = parentColumn == undefined ? ['id'] : ['id', parentColumn];
    }

    /**
     * Whether the rows as they were are read before a write: of a removal, whose ids name the shares to delete.
     * @param write - The write.
     * @returns True for a removal.
     */
    followsBefore(write: EntityWrite): boolean {
        return write.operation === 'remove';
    }

    /**
     * Whether a write runs in a transaction, so that a row and its shares are removed together or not at all.
     * @param write - The write.
     * @returns True for a removal.
     */
    requiresTransaction(write: EntityWrite): boolean {
        return write.operation === 'remove';
    }

    /**
     * Refuses a write placing a row below itself or a row below it, which would leave its rows without a top.
     * @param write - The write.
     * @throws A BadRequestError for such a row.
     */
    async validateWrite(write: ObservedWrite): Promise<void> {
        const parentColumn: string | undefined = this.parentColumn;
        // a restore writes back what was stored, which was checked when it was written
        if (
            parentColumn == undefined
            || write.operation === 'remove'
            || RestoreContextUtilities.isRestoring()
            || !write.data.some(row => Object.hasOwn(row, parentColumn))
        ) {
            return;
        }
        const rowWrites: RowWrite[] = await write.resolveRowWrites();
        for (const rowWrite of rowWrites) {
            const parentId: unknown = rowWrite.data == undefined ? undefined : Reflect.get(rowWrite.data, parentColumn);
            // a row created without an id is new, and nothing can be below it yet
            const rowId: unknown = Reflect.get(rowWrite.existing ?? rowWrite.data ?? {}, 'id');
            if (typeof parentId === 'string' && typeof rowId === 'string') {
                await this.handlers.validateNotBelowItself(rowId, parentId, write.transaction);
            }
        }
    }

    /**
     * Deletes the shares of the rows a removal took, in its transaction, and has the request read what it sees anew.
     * @param write - The write, once it is made.
     */
    async completeWrite(write: MadeWrite): Promise<void> {
        this.handlers.forgetVisibleRows();
        // a restore brings the shares back as they were stored, beside the rows
        if (write.operation !== 'remove' || RestoreContextUtilities.isRestoring()) {
            return;
        }
        const rowIds: string[] = write.before
            .map((row): unknown => Reflect.get(row, 'id'))
            .filter((id): id is string => typeof id === 'string');
        if (rowIds.length) {
            await this.handlers.deleteSharesOf(rowIds, write.transaction);
        }
    }
}