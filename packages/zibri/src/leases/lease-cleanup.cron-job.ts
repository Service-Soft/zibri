import { CreateLeaseData, Lease } from './lease.model';
import { CronExpression } from '../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { Repository } from '../data-source/repository/repository';
import { InjectRepository } from '../di/decorators/inject-repository.decorator';

/**
 * CronJob that removes grants nobody holds any more.
 *
 * Acquiring only clears the lapsed grant for the key being asked for, which is what keeps a
 * contended acquisition from turning into a table scan. That leaves everything else behind, and a
 * retained grant is never handed back by design - a scheduled execution keyed by job and tick is
 * asked for exactly once and then never again. Without this a job on a one minute schedule leaves
 * behind a row a minute, forever.
 *
 * Only lapsed rows are touched. A grant that has not expired is either held right now or belongs to
 * a tick that has not been decided yet, and deleting either would let a second instance take work
 * that is already being done.
 */
export class LeaseCleanupCronJob extends CronJob {
    // eslint-disable-next-line jsdoc/require-jsdoc
    initialConfig: InitialCronConfig = {
        name: 'Lease Cleanup',
        cron: CronExpression.daily().build(),
        runOnInit: false
    };

    constructor(
        @InjectRepository(Lease)
        private readonly leaseRepository: Repository<Lease, CreateLeaseData>
    ) {
        super();
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onTick(): Promise<void> {
        this.logger.info('cleans up expired leases');

        const removed: number = await this.leaseRepository.deleteAll({ expiresAt: { before: new Date() } });
        this.logger.info(`removed ${removed} leases`);
    }
}