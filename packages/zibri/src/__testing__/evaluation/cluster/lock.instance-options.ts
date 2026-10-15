import { ClusterMark, clusterInstanceId, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { ValKeyDataSource, ValKeyOptions } from '../../../data-source/data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { BaseEntity } from '../../../entity/base-entity.model';
import { type LeaseServiceInterface } from '../../../leases/lease-service.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { createTestDataSource, defaultTestServerEntities } from '../../test-server/create-test-data-source.function';
import { defaultTestValKeyEntities } from '../../test-server/create-test-val-key-data-source.function';

/**
 * What every instance of the lock cluster boots with.
 *
 * DataSourceInterface.withLock is the framework's answer to "only one replica may do this at a
 * time". Everything built on it inherits whatever it guarantees - the schema lock that keeps two
 * instances from running migrations at once, and any application code reaching for a named lock.
 *
 * Two data sources: postgres for the marks, valkey for the lock under test. Like every instance
 * options module this is imported by the parent as well, so nothing at the top level may assume it
 * is running inside an instance.
 */

/**
 * How long a lock lives before valkey drops it, in milliseconds.
 *
 * Far below the framework default so the test does not have to run for thirty seconds. Shortening
 * it changes nothing about the mechanism - whatever happens here at two seconds happens there at
 * thirty, it just happens sooner.
 */
export const lockHoldInMs: number = 2000;

/**
 * How long a replica waits to be let into the section, in milliseconds.
 *
 * Comfortably longer than the work, which is the whole reason this is not the same value as the
 * hold: a caller that is willing to queue for a while is not saying its own critical section may
 * only last that long. While the two shared one value that could not be expressed, and this test
 * had to be written around it - the replicas were staggered so that a follower's deadline outlived
 * the leader's key, because starting them together made every follower give up first.
 */
export const lockTimeoutInMs: number = 30000;

/**
 * How long the critical section takes when it comfortably fits inside the lock.
 */
const quickWorkInMs: number = 300;

/**
 * How long the critical section takes when it does not.
 *
 * Longer than the lock lives. A migration on a large table, a batch that grew, a data source having
 * a bad minute - the work does not know a lease is counting down underneath it.
 */
const slowWorkInMs: number = lockHoldInMs * 3;

/**
 * The name of the lock every instance contends for.
 */
const lockKey: string = 'cluster.critical-section';

@DataSource()
class ClusterLockValKeyDataSource extends ValKeyDataSource {
    override options: ValKeyOptions = {
        host: 'localhost',
        useTLS: false,
        keyPrefix: 'cluster-lock'
    };
    entities: Newable<BaseEntity>[] = defaultTestValKeyEntities;
}

/**
 * Enters the contended section on request, and records when it was in there.
 */
@Controller('/cluster-lock')
class ClusterLockController {
    constructor(
        @InjectRepository(ClusterMark)
        private readonly markRepository: Repository<ClusterMark>
    ) {}

    /**
     * Takes the lock for less time than the lock lives.
     */
    @Post('/quick')
    async quick(): Promise<void> {
        await this.enterCriticalSection(quickWorkInMs);
    }

    /**
     * Takes the lock for longer than the lock lives.
     */
    @Post('/slow')
    async slow(): Promise<void> {
        await this.enterCriticalSection(slowWorkInMs);
    }

    /**
     * Runs the critical section under the lock, recording entry and exit.
     *
     * The two marks are what the parent reconstructs the timeline from: ordered by time they have to
     * alternate enter, exit, enter, exit. Two enters in a row means two replicas were inside at
     * once, which is the one thing a lock exists to prevent.
     * @param workInMs - How long to stay inside.
     */
    private async enterCriticalSection(workInMs: number): Promise<void> {
        const leaseService: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
        const instanceId: string = clusterInstanceId();

        // 'wait' rather than 'skip': every caller here has to get in eventually, which is what makes
        // the marks alternate. A skipping caller would simply not appear, and an absent replica
        // proves nothing about exclusion.
        // acquireTimeoutInMs is not the same value as the hold, and defaulting it to the hold is
        // wrong here: the section deliberately outlives its lease, so a follower whose patience only
        // lasted one lease would give up before the leader ever finished and never appear at all.
        await leaseService.withLease(
            { key: lockKey, leaseInMs: lockHoldInMs, mode: 'wait', acquireTimeoutInMs: lockTimeoutInMs },
            async () => {
                await this.markRepository.create({ instanceId, kind: 'lock-enter', tag: lockKey, at: new Date() });

                await new Promise<void>(resolve => {
                    setTimeout(resolve, workInMs);
                });

                await this.markRepository.create({ instanceId, kind: 'lock-exit', tag: lockKey, at: new Date() });
            }
        );
    }
}

const options: StartTestServerOptions = {
    controllers: [ClusterLockController],
    // this repository's own fixtures plus the mark table, the way every other suite here declares a
    // data source: importing the helper above registers JwtUser, and a registered entity no data
    // source declares is refused at boot
    dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, ClusterMark] }), ClusterLockValKeyDataSource],
    // spread rather than replaced: providers is the same field startTestServer takes, where what is
    // passed is what is used, so all the defaults have to be kept here
    providers: defaultClusterProviders
};

export default options;