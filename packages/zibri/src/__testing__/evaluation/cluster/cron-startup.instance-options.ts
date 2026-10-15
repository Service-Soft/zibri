import { ClusterMark, clusterInstanceId, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { CronExpression } from '../../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model';
import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { defineProvider } from '../../../di/models/di-provider.model';

/**
 * What every instance of the cron startup cluster boots with.
 *
 * Like every instance options module, this is imported by the parent as well, so nothing at the top
 * level may assume it is running inside an instance.
 */

/**
 * How long a claim on a scheduled execution lives, in milliseconds.
 *
 * A second rather than the default five minutes, so an instance that boots after it has run out is
 * something a test can wait for. A rolling deploy whose pods take a minute each to become ready gets
 * there with the default.
 */
export const executionLeaseInMs: number = 1000;

/**
 * Records that this instance performed the startup run of a job that asks for one.
 *
 * Daily, so the slot the election is keyed on is the same for every instance however far apart they
 * boot, and no scheduled run lands inside the test to be mistaken for a startup one.
 */
class ClusterStartupCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'cluster-cron-startup',
        cron: CronExpression.daily().build(),
        runOnInit: true
    };

    constructor(
        @InjectRepository(ClusterMark)
        private readonly markRepository: Repository<ClusterMark>
    ) {
        super();
    }

    /**
     * Writes one mark for the run.
     */
    async onTick(): Promise<void> {
        await this.markRepository.create({
            instanceId: clusterInstanceId(),
            kind: 'cron-startup',
            tag: 'startup',
            at: new Date()
        });
    }
}

const options: StartTestServerOptions = {
    cronJobs: [ClusterStartupCronJob],
    // spread rather than replaced: providers is the same field startTestServer takes, where what is
    // passed is what is used, so the real cron service has to be kept here
    providers: [
        ...defaultClusterProviders,
        defineProvider({ token: ZIBRI_DI_TOKENS.CRON_EXECUTION_LEASE_IN_MS, useFactory: () => executionLeaseInMs })
    ]
};

export default options;