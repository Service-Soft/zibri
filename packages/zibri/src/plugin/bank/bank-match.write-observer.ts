import { RestoreContextUtilities } from '../../backup/restore-context.utilities';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { TransactionUtilities } from '../../data-source/transaction/transaction.utilities';
import { EntityWrite, EntityWriteObserver, MadeWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { Inject } from '../../di/decorators/inject.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from './bank.tokens';
import { BankMatch } from './models/bank-match.model';
import { type BankPluginOptions } from './models/bank-plugin-options.model';

/**
 * Writes the state of every bank transaction a write of matches matched or reversed, in the transaction of the write,
 * however the repository got to it. Registered with `matching` of the bank plugin options.
 */
@Injectable({ register: 'onUse' })
export class BankMatchWriteObserver implements EntityWriteObserver, OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly properties: string[] = [];

    constructor(
        @Inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.OPTIONS)
        private readonly options: BankPluginOptions
    ) {}

    /**
     * Registers itself as an observer of every write to a match, with `matching`, without which BankMatch need not be
     * declared.
     */
    onAppInit(): void {
        if (this.options.matching != undefined) {
            inject(EntityWriteObserverRegistry).register(BankMatch, this);
        }
    }

    /**
     * Whether a write creates matches, whose transactions are written in its transaction.
     * @param write - The write.
     * @returns True for an insert, but of a restore.
     */
    requiresTransaction(write: EntityWrite): boolean {
        return write.operation === 'insert' && !RestoreContextUtilities.isRestoring();
    }

    /**
     * Recomputes the state of every transaction a write created a match of, from its matches, in the transaction of
     * the write, which sees the matches it created. A restore brings back the states with the matches, and they are
     * recomputed once it is done, see `BankTransactionWriteObserver`.
     * @param write - The write, once it is made.
     */
    async completeWrite(write: MadeWrite): Promise<void> {
        if (write.operation !== 'insert' || RestoreContextUtilities.isRestoring()) {
            return;
        }
        const byTenant: Map<string, Set<string>> = new Map();
        for (const row of write.after) {
            const tenantId: unknown = Reflect.get(row, 'tenantId');
            const transactionId: unknown = Reflect.get(row, 'transactionId');
            if (typeof tenantId === 'string' && typeof transactionId === 'string') {
                byTenant.set(tenantId, (byTenant.get(tenantId) ?? new Set()).add(transactionId));
            }
        }
        if (!byTenant.size) {
            return;
        }
        const transaction: RepositoryTransaction | undefined = write.transaction;
        // every insert has one, since requiresTransaction has the driver start it for one without
        if (transaction == undefined) {
            throw new InternalError('The state of a bank transaction is written in the transaction of its match, and the write has none.');
        }
        TransactionUtilities.validateNotSpanning(transaction, 'The state of a bank transaction is written in the transaction of its match');
        // one tenant after the other, as the writes of one transaction run over one connection. The matches of a tenant
        // are written one at a time under the lease of the match service, so what this reads is what is committed
        for (const [tenantId, transactionIds] of byTenant) {
            await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
                tenantId,
                async () => await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE).recomputeTransactionStates([...transactionIds], transaction)
            );
        }
    }
}
