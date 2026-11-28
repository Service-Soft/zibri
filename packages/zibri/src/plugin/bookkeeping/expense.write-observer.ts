import { RestoreContextUtilities } from '../../backup/restore-context.utilities';
import { EntityWriteObserver, ObservedWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { inject } from '../../di/inject.function';
import { ConflictError } from '../../error-handling/errors/conflict.error';
import { OnAppInit } from '../../global/on-app-init.interface';
import { $ts } from '../../localization/translate.function';
import { Expense } from './models/expense.model';

/**
 * Keeps an expense as it was recorded, however the repository got to the write: a recorded expense is neither changed
 * nor deleted, and a new expense corrects it.
 */
// here rather than in the expense service, which an application may replace: what was posted holds whatever service
// recorded it
@Injectable({ register: 'onUse' })
export class ExpenseWriteObserver implements EntityWriteObserver, OnAppInit {
    /**
     * What an expense removed, or changed by a write to every expense a filter matches, is read with.
     */
    readonly properties: string[] = ['documentNumber', 'recordedAt'];

    /**
     * Registers itself as an observer of every write to an expense.
     */
    onAppInit(): void {
        inject(EntityWriteObserverRegistry).register(Expense, this);
    }

    /**
     * Refuses a write that changes or removes a recorded expense.
     * @param write - The write about to be made.
     * @throws A ConflictError naming the first expense it would change.
     */
    async validateWrite(write: ObservedWrite): Promise<void> {
        // a restore brings the expenses back as they were stored, beside the entries they posted
        if (write.operation === 'insert' || RestoreContextUtilities.isRestoring()) {
            return;
        }
        const recorded: object | undefined = (await write.resolveRowWrites())
            .flatMap(rowWrite => rowWrite.existing ?? [])
            .find(row => Reflect.get(row, 'recordedAt') != undefined);
        if (recorded != undefined) {
            const documentNumber: string = String(Reflect.get(recorded, 'documentNumber'));
            throw new ConflictError(
                $ts`The expense ${documentNumber} is recorded, and cannot be changed or deleted. A new expense corrects it.`
            );
        }
    }
}
