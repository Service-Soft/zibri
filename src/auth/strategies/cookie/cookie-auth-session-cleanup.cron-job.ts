import { CookieAuthRefreshSession } from './cookie-auth-refresh-session.model';
import { CookieAuthSession } from './cookie-auth-session.model';
import { CronExpression } from '../../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model';
import { Repository } from '../../../data-source/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';

/**
 * A cron job to cleanup expired cookie and cookie refresh sessions.
 */
export class CookieAuthSessionCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Cleanup cookie auth sessions',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @InjectRepository(CookieAuthSession)
        private readonly sessionRepository: Repository<CookieAuthSession>,
        @InjectRepository(CookieAuthRefreshSession)
        private readonly refreshSessionRepository: Repository<CookieAuthRefreshSession>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        await this.sessionRepository.deleteAll({ expirationDate: { before: new Date() } });
        // blacklisted refresh sessions need to stay,
        // to find out if someone tries to use them a second time.
        await this.refreshSessionRepository.deleteAll({ expirationDate: { before: new Date() } });
    }
}