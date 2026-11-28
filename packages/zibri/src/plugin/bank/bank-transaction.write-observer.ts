import { filter, pairwise } from 'rxjs';

import { RestoreContextUtilities } from '../../backup/restore-context.utilities';
import { Repository } from '../../data-source/repository/repository';
import { type RepositoryTransaction } from '../../data-source/transaction/repository-transaction.type';
import { EntityWrite, EntityWriteObserver, MadeWrite } from '../../data-source/write-observers/entity-write-observer.model';
import { EntityWriteObserverRegistry } from '../../data-source/write-observers/entity-write-observer.registry';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { Injectable } from '../../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { OnAppInit } from '../../global/on-app-init.interface';
import { type LoggerInterface } from '../../logging/logger.interface';
import { NumberUtilities } from '../../utilities/number.utilities';
import { BankTransactionStateUtilities } from './bank-transaction-state.utilities';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from './bank.tokens';
import { BankAccount } from './models/bank-account.model';
import { BankTransactionState, type BankTransactionStateCreateData } from './models/bank-transaction-state.model';
import { BankTransaction } from './models/bank-transaction.model';

/**
 * Creates the state of every bank transaction a write creates, open by its whole amount, in the transaction of the
 * write, however the repository got to it: an import of a statement, or a transaction your own code creates.
 */
@Injectable({ register: 'onUse' })
export class BankTransactionWriteObserver implements EntityWriteObserver, OnAppInit {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly properties: string[] = [];

    /**
     * Registers itself as an observer of every write to a bank transaction, and recomputes the states of the
     * transactions once a restore on this instance is done.
     */
    onAppInit(): void {
        inject(EntityWriteObserverRegistry).register(BankTransaction, this);
        // a restore of a tenant brings back its states and keeps its transactions and matches, which are append only,
        // as they are: the states of the backup can be behind them. A restore of the application brings back all three
        // as of one moment, where recomputing finds nothing to change
        inject(ZIBRI_DI_TOKENS.BACKUP_SERVICE).isRestoringBackup
            .pipe(pairwise(), filter(([was, is]) => was && !is))
            .subscribe(() => void this.recomputeAfterRestore());
    }

    /**
     * Whether a write creates transactions, whose states are created in its transaction.
     * @param write - The write.
     * @returns True for an insert, but of a restore.
     */
    requiresTransaction(write: EntityWrite): boolean {
        return write.operation === 'insert' && !RestoreContextUtilities.isRestoring();
    }

    /**
     * Creates the state of every transaction a write created, in its transaction. A restore brings back the states
     * with the transactions, so its writes create none.
     * @param write - The write, once it is made.
     */
    async completeWrite(write: MadeWrite): Promise<void> {
        if (write.operation !== 'insert' || RestoreContextUtilities.isRestoring()) {
            return;
        }
        const created: BankTransaction[] = write.after.filter(row => this.isTransaction(row));
        if (!created.length) {
            return;
        }
        const transaction: RepositoryTransaction | undefined = write.transaction;
        // every insert has one, since requiresTransaction has the driver start it for one without
        if (transaction == undefined) {
            throw new InternalError('The state of a bank transaction is created in the transaction of its write, and the write has none.');
        }
        const states: Repository<BankTransactionState, BankTransactionStateCreateData> = inject(repositoryTokenFor(BankTransactionState));
        const byTenant: Map<string, BankTransactionStateCreateData[]> = new Map();
        for (const row of created) {
            // a transaction has no match yet
            const state: BankTransactionStateCreateData = BankTransactionStateUtilities.resolveState(row, row.amount.abs());
            byTenant.set(row.tenantId, [...byTenant.get(row.tenantId) ?? [], state]);
        }
        // one tenant after the other, as the writes of one transaction run over one connection
        for (const [tenantId, data] of byTenant) {
            await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(tenantId, async () => await states.createAll(data, { transaction }));
        }
    }

    /**
     * Recomputes the state of every transaction of every tenant with a bank account, after a restore, and logs how
     * many it wrote.
     */
    private async recomputeAfterRestore(): Promise<void> {
        try {
            const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
            const tenantIds: Set<string> = new Set();
            for await (const row of inject<Repository<BankAccount>>(repositoryTokenFor(BankAccount)).stream({ select: { tenantId: true }, acrossTenants: true })) {
                tenantIds.add(row.tenantId);
            }
            let written: number = 0;
            // one tenant after the other, as each reads every transaction and match of its tenant
            for (const tenantId of tenantIds) {
                written += (await inject(ZIBRI_DI_TOKENS.TENANT_SERVICE).runAs(
                    tenantId,
                    async () => await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE).recomputeTransactionStates()
                )).length;
            }
            logger.info(`recomputed the states of the bank transactions after a restore, ${written} of which changed`);
        }
        catch (error) {
            // BankTransactionStateCronJob recomputes them again within a day. Logged where the application still runs:
            // one stopping meanwhile has no logger to log with
            try {
                inject(ZIBRI_DI_TOKENS.LOGGER)
                    .error(new InternalError('Could not recompute the states of the bank transactions after a restore.', { cause: error }));
            }
            catch {
                // the application stopped
            }
        }
    }

    private isTransaction(row: object): row is BankTransaction {
        return 'id' in row && typeof row.id === 'string'
            && 'tenantId' in row && typeof row.tenantId === 'string'
            && 'accountId' in row && typeof row.accountId === 'string'
            && 'statementId' in row && typeof row.statementId === 'string'
            && 'bookingDate' in row && row.bookingDate instanceof Date
            && 'amount' in row && NumberUtilities.isBigNumber(row.amount);
    }
}
