import { type EmailServiceInterface } from './email-service.interface.ts';
import { CronExpression } from '../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';

/**
 * Deletes the failed emails that are older than `failedRetentionInMs`.
 */
export class EmailCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Email Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
        private readonly emailService: EmailServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        const removed: number = await this.emailService.deleteExpiredFailedEmails();
        this.logger.info(`removed ${removed} failed emails`);
    }
}