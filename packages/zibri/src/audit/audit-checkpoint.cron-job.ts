import { type AuditServiceInterface } from './audit-service.interface';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * Seals the audit entries of every hour that ended in an `AuditCheckpoint` per tenant.
 */
export class AuditCheckpointCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Audit Checkpoints',
        // a few minutes into the hour, past the delay before an hour is sealed
        cron: CronExpression.every(1, 'hours').at(10, 'minutes')
            .build(),
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
        const written: number = await this.auditService.writeCheckpoints();
        this.logger.info(`wrote ${written} audit checkpoints`);
    }
}