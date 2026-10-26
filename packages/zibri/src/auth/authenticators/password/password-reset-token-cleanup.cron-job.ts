import { CronExpression } from '../../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model';
import { Repository } from '../../../data-source/repository/repository';
import { repositoryTokenFor } from '../../../di/decorators/inject-repository.decorator';
import { inject } from '../../../di/inject.function';
import { PasswordResetToken, PasswordResetTokenCreateData } from '../../models/password-reset-token.model';

/**
 * Deletes the password reset tokens that expired before they were used.
 */
export class PasswordResetTokenCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup password reset tokens',
        cron: CronExpression.every(1, 'hours').build(),
        runOnInit: false
    };

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        const tokenRepository: Repository<PasswordResetToken, PasswordResetTokenCreateData> = inject(repositoryTokenFor(PasswordResetToken));
        await tokenRepository.deleteAll({ expirationDate: { before: new Date() } });
    }
}
