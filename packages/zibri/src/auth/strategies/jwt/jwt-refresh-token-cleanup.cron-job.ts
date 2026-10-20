import { JwtRefreshToken } from './jwt-refresh-token.model.ts';
import { CronExpression } from '../../../cron/cron-expression.utilities.ts';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model.ts';
import { Repository } from '../../../data-source/repository/repository.ts';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator.ts';

/**
 * A cron job to cleanup expired jwt refresh tokens.
 */
export class JwtRefreshTokenCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc-js/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup jwt refresh tokens',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @InjectRepository(JwtRefreshToken)
        private readonly refreshTokenRepository: Repository<JwtRefreshToken>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onTick(): Promise<void> {
        // blacklisted tokens need to stay, to find out
        // if someone tries to use them a second time.
        await this.refreshTokenRepository.deleteAll({ expirationDate: { before: new Date() } });
    }
}