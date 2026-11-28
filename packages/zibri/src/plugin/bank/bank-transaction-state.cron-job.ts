import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { ZIBRI_BANK_PLUGIN_DI_TOKENS } from './bank.tokens';
import { BankAccount } from './models/bank-account.model';
import { type BankTransactionState } from './models/bank-transaction-state.model';

/**
 * Recomputes the state of every bank transaction of every tenant once a day from the transactions and their matches,
 * writes each that differs or is missing, and logs it as an error: a state is written with every match, so one that
 * differs was written around the bank plugin. Registered for you by `ZibriBankPlugin`.
 */
export class BankTransactionStateCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Bank Transaction States',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const accounts: Repository<BankAccount> = inject(repositoryTokenFor(BankAccount));
        // the tenants with a bank account, which every transaction is booked on
        const tenantIds: Set<string> = new Set();
        for await (const row of accounts.stream({ select: { tenantId: true }, acrossTenants: true })) {
            tenantIds.add(row.tenantId);
        }
        const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        let corrected: number = 0;
        // one tenant after the other: a check reads every transaction and match of its tenant
        for (const tenantId of tenantIds) {
            // read when used rather than injected, for the reason ApprovalRequestExpiryCronJob reads its service so
            const written: BankTransactionState[] = await tenants.runAs(
                tenantId,
                async () => await inject(ZIBRI_BANK_PLUGIN_DI_TOKENS.BANK_MATCH_SERVICE).recomputeTransactionStates()
            );
            if (written.length) {
                corrected += written.length;
                this.logger.error(new InternalError([
                    `The states of ${written.length} bank transactions of the tenant ${tenantId} did not hold, and were recomputed.`,
                    ...written.map(s => `${s.transactionId}: ${s.status} ${s.openAmount.toFixed()}`)
                ]));
            }
        }
        this.logger.info(`checked the bank transactions of ${tenantIds.size} tenants, ${corrected} of whose states were recomputed`);
    }
}