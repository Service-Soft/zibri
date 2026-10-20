import { describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { MultithreadingServiceInterface } from './multithreading-service.interface.ts';
import { MultithreadingService } from './multithreading.service.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider, DiProvider } from '../../di/models/di-provider.model.ts';
import { LeaseOptions } from '../../leases/lease-options.model.ts';
import { LeaseService } from '../../leases/lease.service.ts';
import { FsUtilities } from '../../utilities/fs.utilities.ts';
import { Ms } from '../../utilities/ms.ts';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model.ts';
import { ThreadJobEntity } from '../models/thread-job-entity.model.ts';
import { ThreadJobStatus } from '../models/thread-job-status.enum.ts';

/**
 * Lets the test hold a round of handing out work at the one point it can be held from outside.
 *
 * A round reads the queue, then claims a job - and the claim is asked of the lease service. Held
 * there, the round is exactly as far along as the one that failed for real: past the check that the
 * pool is running, and about to use the data source.
 */
let signalClaimAsked: () => void = () => undefined;
const claimAsked: Promise<void> = new Promise<void>(resolve => {
    signalClaimAsked = resolve;
});
let releaseClaim: () => void = () => undefined;
const claimReleased: Promise<void> = new Promise<void>(resolve => {
    releaseClaim = resolve;
});

class HeldLeaseService extends LeaseService {
    override async withLease<T>(options: LeaseOptions, fn: () => Promise<T>): Promise<T | undefined> {
        if (options.key.startsWith('thread-job:')) {
            signalClaimAsked();
            await claimReleased;
        }
        return await super.withLease(options, fn);
    }
}

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

const providers: DiProvider<unknown>[] = [
    ...defaultTestServerProviders,
    defineProvider({
        token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
        useValue: {
            maxThreads: 1,
            maxPriorityThreads: 0,
            defaultTimeoutMs: Ms.HOUR,
            defaultTimeoutPriorityMs: Ms.MINUTE * 5,
            jobClaimInMs: Ms.SECOND * 30,
            enableTsWorkerFiles: true
        }
    }),
    defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService }),
    defineProvider({ token: ZIBRI_DI_TOKENS.LEASE_SERVICE, useClass: HeldLeaseService })
];

/**
 * Waits, without holding the event loop open past the suite.
 * @param ms - How long to wait.
 */
async function wait(ms: number): Promise<void> {
    await new Promise<void>(resolve => {
        setTimeout(resolve, ms).unref();
    });
}

describe('shutting down a thread job pool', () => {

    it('waits for a round of handing out work that is already running', async () => {
        const server: StartedTestServer = await startTestServer({ dataSources: [dataSourceClass], providers });
        const multithreadingService: MultithreadingServiceInterface = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        const threadJobRepository: Repository<ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>>
            = inject(repositoryTokenFor(ThreadJobEntity));

        const workerData: BaseThreadJobWorkerData & { amount: number } = {
            filePath: FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts'),
            amount: 10
        };
        await threadJobRepository.create({
            queuedAtMs: Date.now(),
            status: ThreadJobStatus.IN_QUEUE,
            priority: false,
            progress: 0,
            timeout: Ms.HOUR,
            workerData
        });

        const events: string[] = [];
        // the way a completed job starts the next round: nobody waits for it but the worker's
        // message handler, which nothing waits for either
        const round: Promise<void> = (async () => {
            await multithreadingService.startQueuedJobs();
            events.push('round over');
        })();
        await claimAsked;

        const shutdown: Promise<void> = (async () => {
            await server.shutdown();
            events.push('shut down');
        })();
        await wait(200);

        // what failed for real: the application went away while the round was still using the data
        // source, and the query it was running was cut off underneath it
        expect(events).toEqual([]);

        releaseClaim();
        await Promise.all([round, shutdown]);

        expect(events).toEqual(['round over', 'shut down']);
    }, 30000);
});