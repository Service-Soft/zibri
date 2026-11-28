import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { InternalError } from '../../error-handling/internal-error.model';
import { AuditAction, AuditOutcome, AuditReason } from '../../logging/audit-event.model';
import { type TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS } from './bookkeeping.tokens';
import { BookkeepingSettings } from './models/bookkeeping-settings.model';
import { type BookkeepingVerification } from './models/bookkeeping-verification.model';

/**
 * Checks the books of every tenant once a day, and records each problem it finds in the audit trail of the tenant, as
 * `bookkeeping.verification` with the reason `tampered`. Registered for you by `ZibriBookkeepingPlugin`.
 */
export class BookkeepingVerificationCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Bookkeeping Verification',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const settings: Repository<BookkeepingSettings> = inject(repositoryTokenFor(BookkeepingSettings));
        // the tenants keeping books, whose entries are chained per tenant
        const tenantIds: Set<string> = new Set();
        for await (const row of settings.stream({ select: { tenantId: true }, acrossTenants: true })) {
            tenantIds.add(row.tenantId);
        }
        const tenants: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        let broken: number = 0;
        // one tenant after the other: a check reads every entry and line of its tenant
        for (const tenantId of tenantIds) {
            const verification: BookkeepingVerification = await tenants.runAs(tenantId, async () => {
                // read when used rather than injected, for the reason ApprovalRequestExpiryCronJob reads its service so
                const res: BookkeepingVerification = await inject(ZIBRI_BOOKKEEPING_PLUGIN_DI_TOKENS.JOURNAL_SERVICE).resolveVerification();
                for (const problem of res.problems) {
                    inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE).record({
                        action: AuditAction.BOOKKEEPING_VERIFICATION,
                        outcome: AuditOutcome.FAILURE,
                        reason: AuditReason.TAMPERED,
                        subject: problem.lineId ?? problem.entryId ?? undefined
                    });
                }
                return res;
            });
            if (!verification.intact) {
                broken++;
                this.logger.error(new InternalError([
                    `The books of the tenant ${tenantId} do not hold.`,
                    ...verification.problems.map(p => `${p.lineId ?? p.entryId ?? ''}: ${p.reason}`)
                ]));
            }
            else {
                // where the chains end, to compare with the next check: a chain alone cannot tell its newest rows removed
                this.logger.info(
                    // eslint-disable-next-line stylistic/max-len
                    `the books of the tenant ${tenantId} hold, up to the entry ${verification.newestEntrySequence} ${verification.newestEntryHash} and the line ${verification.newestLineSequence} ${verification.newestLineHash}`
                );
            }
        }
        this.logger.info(`checked the books of ${tenantIds.size} tenants, ${broken} of which do not hold`);
    }
}