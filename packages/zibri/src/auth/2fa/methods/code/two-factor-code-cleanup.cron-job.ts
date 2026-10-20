import { TwoFactorCode, TwoFactorCodeCreateData } from './two-factor-code.model.ts';
import { CronExpression } from '../../../../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../../../../cron/cron-job.model.ts';
import { Repository } from '../../../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../../../di/decorators/inject-repository.decorator.ts';
import { inject } from '../../../../di/inject.function.ts';

/**
 * Deletes the codes sent by email or text message that expired before they were entered.
 */
export class TwoFactorCodeCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup two factor codes',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        const codeRepository: Repository<TwoFactorCode, TwoFactorCodeCreateData> = inject(repositoryTokenFor(TwoFactorCode));
        await codeRepository.deleteAll({ expirationDate: { before: new Date() } });
    }
}