import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { inject } from '../../di/inject.function';
import { ZIBRI_APPROVAL_PLUGIN_DI_TOKENS } from './approval.tokens';

/**
 * Closes the pending approval requests of every tenant that expired, as `EXPIRED`, every five minutes.
 */
export class ApprovalRequestExpiryCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly initialConfig: InitialCronConfig = {
        name: 'Approval Request Expiry',
        cron: CronExpression.every(5, 'minutes').build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        // read when used rather than injected, for the reason PaymentReconciliationCronJob reads its service so
        const closed: number = await inject(ZIBRI_APPROVAL_PLUGIN_DI_TOKENS.APPROVAL_REQUEST_SERVICE).closeExpiredRequests();
        this.logger.info(`closed ${closed} expired approval requests`);
    }
}