import { MailingListSubscriptionConfirmationToken, MailingListSubscriptionConfirmationTokenCreateData } from './models/mailing-list-subscription-confirmation-token.model.ts';
import { CronExpression } from '../../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../di/inject.function.ts';

/**
 * Deletes the subscription confirmation tokens of every tenant that expired, whether they were spent or not.
 */
export class MailingListConfirmationTokenCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup mailing list confirmation tokens',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        // read when used rather than injected, for the reason MailingListService gives
        const tokenRepository: Repository<MailingListSubscriptionConfirmationToken, MailingListSubscriptionConfirmationTokenCreateData>
            = inject(repositoryTokenFor(MailingListSubscriptionConfirmationToken));
        await tokenRepository.deleteAll({ expirationDate: { before: new Date() } }, { acrossTenants: true });
    }
}