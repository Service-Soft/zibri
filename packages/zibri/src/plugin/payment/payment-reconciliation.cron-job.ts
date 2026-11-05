import { ZIBRI_PAYMENT_PLUGIN_DI_TOKENS } from './payment.tokens';
import { CronExpression } from '../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../cron/cron-job.model';
import { inject } from '../../di/inject.function';

/**
 * Asks the payment providers every hour what became of the payments nobody confirmed within their
 * provider's `approvalWindowInMs`, and records it: paid, reserved or cancelled.
 */
export class PaymentReconciliationCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Reconcile abandoned payments',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        // read when used rather than injected, for the reason PaymentService reads its repository so
        const reconciled: number = await inject(ZIBRI_PAYMENT_PLUGIN_DI_TOKENS.PAYMENT_SERVICE).reconcileAbandonedPayments();
        this.logger.info(`reconciled ${reconciled} abandoned payments`);
    }
}