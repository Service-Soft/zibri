import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { MultithreadingServiceInterface } from './multithreading-service.interface';
import { MultithreadingService } from './multithreading.service';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { waitUntil } from '../../__testing__/wait-until.function';
import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { NotFoundError } from '../../error-handling/errors/not-found.error';
import { TenantServiceInterface } from '../../tenancy/tenant-service.interface';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

/**
 * A thread job row as the repository hands it back, for the reason multithreading.service.test.ts gives.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

/**
 * What the worker file is handed.
 */
type AmountWorkerData = BaseThreadJobWorkerData & {
    /**
     * What the worker file computes its result from.
     */
    amount: number
};

// in memory, so that what a job does across tenants can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

const workerFile: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.ts');

describe('MultithreadingService across tenants', () => {
    const tenantA: string = UUIDUtilities.generate();
    const tenantB: string = UUIDUtilities.generate();

    let server: StartedTestServer;
    let multithreadingService: MultithreadingServiceInterface;
    let tenants: TenantServiceInterface;
    let jobs: Repository<AnyThreadJobEntity>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
                    useValue: {
                        maxThreads: 1,
                        maxPriorityThreads: 0,
                        defaultTimeoutMs: Ms.MINUTE,
                        defaultTimeoutPriorityMs: Ms.MINUTE,
                        jobClaimInMs: Ms.SECOND * 30,
                        enableTsWorkerFiles: true
                    }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
            ]
        });
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        tenants = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        jobs = inject(repositoryTokenFor(ThreadJobEntity));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('keeps a job in the tenant it was queued in, and records how it ended', async () => {
        const finished: ThreadJobEntity<{ filePath: FsPath }, unknown> = await tenants.runAs(
            tenantA,
            async () => await multithreadingService.runThreadJob({ workerData: { filePath: workerFile, amount: 10 } })
        );
        expect(finished.status).toBe(ThreadJobStatus.COMPLETED);
        expect(finished.result).toBe(55);

        const stored: AnyThreadJobEntity = await jobs.findById(finished.id, { acrossTenants: true });
        expect(stored.tenantId).toBe(tenantA);
        expect(stored.status).toBe(ThreadJobStatus.COMPLETED);

        // another tenant cannot wait on it, the same as on a job that does not exist
        await tenants.runAs(tenantB, async () => {
            await expect(multithreadingService.waitForThreadJob(finished.id)).rejects.toThrow(NotFoundError);
        });
    });

    it('calls the code that queued a job back in the tenant it was queued in', async () => {
        let completedIn: string | undefined = 'never called';
        await tenants.runAs(tenantA, async () => await multithreadingService.runThreadJob({
            workerData: { filePath: workerFile, amount: 10 },
            // what the worker reports arrives outside every tenant, and a callback reaching the
            // rows of no tenant - or sending to every tenant - from there would leave its own
            onComplete: () => {
                completedIn = tenants.getActiveTenantId();
            }
        }));

        expect(completedIn).toBe(tenantA);
    });

    it('runs the queued jobs of every tenant from outside all of them', async () => {
        // what another instance queued and never got to: stored, and waiting for any worker
        const workerData: AmountWorkerData = { filePath: workerFile, amount: 12 };
        const queued: AnyThreadJobEntity = await tenants.runAs(tenantB, async () => await jobs.create({
            queuedAtMs: Date.now(),
            status: ThreadJobStatus.IN_QUEUE,
            priority: false,
            progress: 0,
            workerData,
            timeout: Ms.MINUTE
        }));

        // outside every tenant, the way the poll runs it
        await multithreadingService.startQueuedJobs();
        await waitUntil(async () => (await jobs.findById(queued.id, { acrossTenants: true })).status === ThreadJobStatus.COMPLETED, 15000);
        expect((await jobs.findById(queued.id, { acrossTenants: true })).result).toBe(144);
    }, 20000);
});