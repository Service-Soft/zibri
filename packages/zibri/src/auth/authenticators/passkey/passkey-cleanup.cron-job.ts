import { type PasskeyServiceInterface } from './passkey-service.interface';
import { CronExpression } from '../../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model';
import { Inject } from '../../../di/decorators/inject.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';

/**
 * Deletes the passkey challenges that expired before they were answered, and the registration
 * tickets that expired before they were spent.
 */
export class PasskeyCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup passkey challenges',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false
    };

    constructor(
        @Inject(ZIBRI_DI_TOKENS.PASSKEY_SERVICE)
        private readonly passkeyService: PasskeyServiceInterface
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.passkeyService.deleteExpired();
    }
}