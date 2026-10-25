import { type EmailServiceInterface } from './email-service.interface';
import { Email } from './models/email.model';
import { CronExpression } from '../cron/cron-expression.utilities';
import { InitialCronConfig } from '../cron/cron-job.model';
import { Inject } from '../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { BaseEntity } from '../entity/base-entity.model';
import { PollingCronJob } from '../polling/polling-cron-job.model';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { Newable } from '../types/newable.type';

/**
 * Cron Job for sending out queued emails.
 */
export class SendQueuedEmailsCronJob extends PollingCronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'send queued emails',
        cron: CronExpression.every(5, 'seconds').build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly wakeUpTopic: string = WAKE_UP_TOPICS.EMAILS;

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected readonly polledEntity: Newable<BaseEntity> = Email;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE)
        private readonly emailService: EmailServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    protected async poll(): Promise<boolean> {
        let sentAny: boolean = false;
        while (await this.emailService.sendQueuedEmails()) {
            sentAny = true;
        }
        return sentAny;
    }
}