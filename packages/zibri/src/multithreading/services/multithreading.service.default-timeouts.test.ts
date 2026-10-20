import { afterAll, beforeAll, describe, expect, it } from 'vitest';
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
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities.ts';
import { Ms } from '../../utilities/ms.ts';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model.ts';
import { ThreadJobEntity } from '../models/thread-job-entity.model.ts';

const computingWorker: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.test.worker.ts');

// in memory, so the timeout a queued job is given can be read off its row without a container
describe('MultithreadingService, given a job without a timeout', () => {
    let server: StartedTestServer;
    let multithreadingService: MultithreadingServiceInterface;
    let threadJobs: Repository<ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
                    useValue: {
                        maxThreads: 1,
                        maxPriorityThreads: 1,
                        defaultTimeoutMs: Ms.HOUR,
                        defaultTimeoutPriorityMs: Ms.MINUTE * 5,
                        jobClaimInMs: Ms.SECOND * 30,
                        enableTsWorkerFiles: true
                    }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
            ]
        });
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
        threadJobs = inject(repositoryTokenFor(ThreadJobEntity));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('gives a normal job defaultTimeoutMs', async () => {
        const id: string = await multithreadingService.queueThreadJob({ workerData: { filePath: computingWorker, amount: 1 } });

        expect((await threadJobs.findById(id)).timeout).toBe(Ms.HOUR);
    });

    it('gives a priority job defaultTimeoutPriorityMs', async () => {
        const id: string = await multithreadingService.queueThreadJob({ workerData: { filePath: computingWorker, amount: 1 }, priority: true });

        expect((await threadJobs.findById(id)).timeout).toBe(Ms.MINUTE * 5);
    });
});