import { type EmailServiceInterface } from './email-service.interface.ts';
import { CronExpression } from '../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';

/**
 * Cron Job for sending out queued emails.
 */
export class SendQueuedEmailsCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'send queued emails',
        cron: CronExpression.every(5, 'seconds').build(),
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
        let goOn: boolean = true;
        while (goOn) {
            goOn = await this.emailService.sendQueuedEmails();
        }
    }
}