import { CronJob, InitialCronConfig } from '../cron';
import { inject, Injectable, ZIBRI_DI_TOKENS } from '../di';
import { MailServiceInterface } from './mail-service.interface';

@Injectable()
export class SendQueuedMailsCronJob extends CronJob {
    initialConfig: InitialCronConfig = {
        name: 'send queued mails',
        cron: '*/5 * * * * *',
        runOnInit: false
    };

    async onTick(): Promise<void> {
        const mailService: MailServiceInterface = inject(ZIBRI_DI_TOKENS.MAIL_SERVICE);
        let goOn: boolean = true;
        while (goOn) {
            goOn = await mailService.sendQueuedMails();
        }
    }
}