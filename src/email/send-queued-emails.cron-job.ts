import { type EmailServiceInterface } from './email-service.interface';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';

/**
 * Cron Job for sending out queued emails.
 */
export class SendQueuedEmailsCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'send queued emails',
        cron: '*/5 * * * * *',
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
        private readonly emailService: EmailServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        let goOn: boolean = true;
        while (goOn) {
            goOn = await this.emailService.sendQueuedEmails();
        }
    }
}