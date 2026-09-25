import { ClusterMark, clusterInstanceId, StartTestServerOptions } from 'zibri-testing';

import { CronExpression } from '../../../cron/cron-expression.utilities';
import { CronJob, InitialCronConfig } from '../../../cron/cron-job.model';
import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';

/**
 * What every instance of the cron cluster boots with.
 *
 * Like every instance options module, this is imported by the parent as well, so nothing at the top
 * level may assume it is running inside an instance.
 */

/**
 * How often the job is scheduled, in milliseconds.
 *
 * Three seconds rather than one, because node-cron is handed a maxRandomDelay of one second: a run
 * for the tick at t executes somewhere in [t, t+1s), so the period has to be comfortably longer
 * than that delay or two replicas running the same tick would be bucketed as different ones and the
 * duplication this test looks for would hide itself.
 */
const tickIntervalInMs: number = 3000;

/**
 * Which scheduled tick a run belongs to.
 *
 * Read at the very start of the handler, so the value describes when the job fired rather than how
 * long its write took. Every replica running the same tick computes the same bucket, which is what
 * makes "one row per bucket" a meaningful assertion.
 * @returns The bucket, as a string, because a mark's tag is one.
 */
function currentTick(): string {
    return String(Math.floor(Date.now() / tickIntervalInMs));
}

/**
 * Records that this instance ran a scheduled job, and which tick it ran for.
 */
class ClusterCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = {
        name: 'cluster-cron',
        cron: CronExpression.fromString('*/3 * * * * *'),
        // off, so that only genuinely scheduled runs are recorded. Every instance firing every job
        // again on every restart is a finding of its own, and mixing it in here would make this
        // test fail for two reasons at once.
        runOnInit: false
    };

    constructor(
        @InjectRepository(ClusterMark)
        private readonly markRepository: Repository<ClusterMark>
    ) {
        super();
    }

    /**
     * Writes one mark for the tick that just fired.
     */
    async onTick(): Promise<void> {
        await this.markRepository.create({
            instanceId: clusterInstanceId(),
            kind: 'cron',
            tag: currentTick(),
            at: new Date()
        });
    }
}

const options: StartTestServerOptions = {
    cronJobs: [ClusterCronJob]
};

export default options;