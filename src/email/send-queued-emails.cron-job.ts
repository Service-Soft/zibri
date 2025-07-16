import { CronJob, InitialCronConfig } from '../cron';
import { inject, Injectable, ZIBRI_DI_TOKENS } from '../di';
import { EmailServiceInterface } from './email-service.interface';

/**
 * Cron Job for sending out queued emails.
 */
@Injectable()
export class SendQueuedEmailsCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'send queued emails',
        cron: '*/5 * * * * *',
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const emailService: EmailServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        let goOn: boolean = true;
        while (goOn) {
            goOn = await emailService.sendQueuedEmails();
        }
    }
}