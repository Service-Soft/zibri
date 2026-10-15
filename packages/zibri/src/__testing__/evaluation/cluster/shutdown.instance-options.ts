import { ClusterMark, clusterInstanceId, defaultClusterProviders, StartTestServerOptions } from 'zibri-testing';

import { ValKeyDataSource, ValKeyOptions } from '../../../data-source/data-sources/val-key/val-key-data-source.model';
import { DataSource } from '../../../data-source/decorators/data-source.decorator';
import { Repository } from '../../../data-source/repository/repository';
import { InjectRepository } from '../../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../../di/default/zibri-di-tokens.default';
import { inject } from '../../../di/inject.function';
import { defineProvider } from '../../../di/models/di-provider.model';
import { BaseEntity } from '../../../entity/base-entity.model';
import { type LeaseServiceInterface } from '../../../leases/lease-service.interface';
import { type LoggerInterface } from '../../../logging/logger.interface';
import { Controller } from '../../../routing/decorators/controller.decorator';
import { Post } from '../../../routing/decorators/post.decorator';
import { Newable } from '../../../types/newable.type';
import { createTestDataSource, defaultTestServerEntities } from '../../test-server/create-test-data-source.function';
import { defaultTestValKeyEntities } from '../../test-server/create-test-val-key-data-source.function';

/**
 * What every instance of the shutdown cluster boots with.
 *
 * The question here is what happens to a grant when the replica holding it is asked to stop. It is
 * still doing the work, so handing the grant over immediately would let a second replica start the
 * same work - and holding on to it until it expires makes every other replica wait out a lease for
 * work that stopped seconds ago. LeaseService drains instead, and this is where that is observed.
 *
 * Like every instance options module this is imported by the parent as well, so nothing at the top
 * level may assume it is running inside an instance.
 */

/**
 * How long the section is occupied for, in milliseconds.
 *
 * Long enough that it is still running when the replica is asked to shut down, which is the only
 * arrangement where the drain has anything to decide.
 */
const workInMs: number = 30000;

/**
 * How long a lock lives once taken, in milliseconds.
 *
 * Deliberately far longer than the test runs. Nothing here may pass because a lease quietly expired
 * - the successor has to get in because the shutdown handed the lock back, and at a minute that is
 * the only explanation available.
 */
export const lockHoldInMs: number = 60000;

/**
 * How long a shutting down replica waits for work it holds a grant on, in milliseconds.
 *
 * Short, because the work here deliberately never finishes in time. A real deployment wants this
 * long enough for ordinary work to complete on its own. Both this and the http drain below have to
 * fit inside the five seconds the harness gives a replica to exit before it resorts to SIGKILL -
 * which is the same bind a real deployment is in with its orchestrator's grace period.
 */
export const leaseDrainTimeoutInMs: number = 1000;

/**
 * How long open requests get to finish before the shutdown goes ahead without them, in milliseconds.
 */
export const httpDrainTimeoutInMs: number = 1000;

/**
 * How long a request that refuses to end takes, in milliseconds.
 *
 * Far past the drain above. Closing the http server waits for every open connection, and that
 * happens before any shutdown hook, so an unbounded wait here would mean nothing else in the
 * shutdown ever runs - the leases included.
 */
const slowRequestInMs: number = 60000;

/**
 * The lock both replicas contend for.
 */
export const sectionKey: string = 'cluster.shutdown-section';

/**
 * A second lock, for the case where a request is holding the shutdown up.
 *
 * Its own key because the replica that takes over in the first scenario is still inside the section
 * when the next one starts, and a test that had to wait that out would be testing patience.
 */
export const blockedSectionKey: string = 'cluster.shutdown-blocked-section';

@DataSource()
class ShutdownValKeyDataSource extends ValKeyDataSource {
    override options: ValKeyOptions = {
        host: 'localhost',
        useTLS: false,
        keyPrefix: 'cluster-shutdown'
    };
    entities: Newable<BaseEntity>[] = defaultTestValKeyEntities;
}

/**
 * Starts work that holds a lock for far longer than the shutdown will wait.
 */
@Controller('/cluster-shutdown')
class ClusterShutdownController {
    constructor(
        @InjectRepository(ClusterMark)
        private readonly markRepository: Repository<ClusterMark>
    ) {}

    /**
     * Begins occupying the shared section and answers straight away.
     *
     * Deliberately not awaited. A request that is still open holds the http server open too, and
     * that is closed before any shutdown hook runs - so waiting here would mean the drain never gets
     * to decide anything. Detached, this is the same shape as the case that matters in production: a
     * cron tick, which keeps running because node-cron's stop only clears the timer.
     */
    @Post('/enter')
    enter(): void {
        void this.occupySection(sectionKey);
    }

    /**
     * Same, on the lock used for the scenario where a request is holding the shutdown up.
     */
    @Post('/enter-blocked')
    enterBlocked(): void {
        void this.occupySection(blockedSectionKey);
    }

    /**
     * A request that stays open for far longer than the shutdown is willing to wait.
     *
     * Closing the http server waits for every open connection, and it runs before any shutdown hook,
     * so one of these used to be enough to stop the whole shutdown - the replica would be killed at
     * the orchestrator's grace period with every lease it held still held.
     */
    @Post('/slow-request')
    async slowRequest(): Promise<void> {
        await new Promise<void>(resolve => {
            setTimeout(resolve, slowRequestInMs);
        });
    }

    /**
     * Holds the lock, records both ends of the section, and takes its time in between.
     * @param key - The lock to contend for.
     */
    private async occupySection(key: string): Promise<void> {
        const leaseService: LeaseServiceInterface = inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
        const instanceId: string = clusterInstanceId();

        try {
            // 'wait', because the whole point is that the replica taking over gets in - the grant
            // being handed back on shutdown is only observable if somebody is queueing for it
            await leaseService.withLease({ key, leaseInMs: lockHoldInMs, mode: 'wait', acquireTimeoutInMs: lockHoldInMs }, async () => {
                await this.markRepository.create({
                    instanceId,
                    kind: 'section-enter',
                    tag: key,
                    at: new Date()
                });

                await new Promise<void>(resolve => {
                    setTimeout(resolve, workInMs);
                });

                await this.markRepository.create({
                    instanceId,
                    kind: 'section-exit',
                    tag: key,
                    at: new Date()
                });
            });
        }
        catch (error) {
            // the replica holding this is killed on purpose, so a failure on the way out is
            // expected. Logged rather than swallowed, because a failure anywhere else is not.
            inject<LoggerInterface>(ZIBRI_DI_TOKENS.LOGGER).warn(
                `could not finish the section: ${error instanceof Error ? error.message : error}`
            );
        }
    }
}

const options: StartTestServerOptions = {
    controllers: [ClusterShutdownController],
    // this repository's own fixtures plus the mark table, the way every other suite here declares a
    // data source: importing the helper above registers JwtUser, and a registered entity no data
    // source declares is refused at boot
    dataSources: [createTestDataSource({ entities: [...defaultTestServerEntities, ClusterMark] }), ShutdownValKeyDataSource],
    // spread rather than replaced: providers is the same field startTestServer takes, where what is
    // passed is what is used, so all the defaults have to be kept here
    providers: [
        ...defaultClusterProviders,
        defineProvider({
            token: ZIBRI_DI_TOKENS.LEASE_DRAIN_TIMEOUT_IN_MS,
            useFactory: () => leaseDrainTimeoutInMs
        }),
        defineProvider({
            token: ZIBRI_DI_TOKENS.HTTP_DRAIN_TIMEOUT_IN_MS,
            useFactory: () => httpDrainTimeoutInMs
        })
    ]
};

export default options;