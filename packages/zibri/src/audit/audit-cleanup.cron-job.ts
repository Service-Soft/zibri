import { type AuditServiceInterface } from './audit-service.interface';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * Deletes the audit entries older than `ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS`.
 */
export class AuditCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Audit Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.AUDIT_SERVICE)
        private readonly auditService: AuditServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const removed: number = await this.auditService.deleteExpiredEntries();
        this.logger.info(`removed ${removed} audit entries`);
    }
}