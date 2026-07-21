import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { MultithreadingServiceInterface } from './multithreading-service.interface';
import { MultithreadingService } from './multithreading.service';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { Repository } from '../../data-source/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../models/thread-job-entity.model';
import { ThreadJobStatus } from '../models/thread-job-status.enum';

let multithreadingService: MultithreadingServiceInterface;
let server: StartedTestServer;

describe('MultithreadingService', () => {
    beforeAll(async () => {
        server = await startTestServer({
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
                    // kept minimal (1 thread, no dedicated priority worker) so this also works on
                    // CI runners that may only expose a single CPU thread
                    useValue: {
                        maxThreads: 1,
                        maxPriorityThreads: 0,
                        defaultTimeoutMs: Ms.HOUR,
                        defaultTimeoutPriorityMs: Ms.MINUTE * 5
                    }
                }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE,
                    useClass: MultithreadingService
                })
            ]
        });
        multithreadingService = inject(ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE);
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('can run a ts worker file', async () => {
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.ts');
        const res: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath, amount: 40 } });
        expect(res.result).toEqual(102334155);
    });

    it('can run a js worker file', async () => {
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.js');
        const res: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath, amount: 40 } });
        expect(res.result).toEqual(102334155);
    });

    it('marks the job as FAILED with the propagated error when the worker file throws synchronously', async () => {
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.throwing.test.worker.ts');
        const res: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath } });

        expect(res.status).toBe(ThreadJobStatus.FAILED);
        expect(res.error?.message).toContain('worker fixture: intentional failure');
    }, 15000);

    it('marks the job as FAILED and recovers a fresh worker when the worker thread crashes outright', async () => {
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.crashing.test.worker.ts');
        const res: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath } });

        expect(res.status).toBe(ThreadJobStatus.FAILED);

        // the pool should have recovered a replacement worker and still be able to run further jobs
        const followUpFilePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.ts');
        const followUp: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({
            workerData: { filePath: followUpFilePath, amount: 10 }
        });
        expect(followUp.status).toBe(ThreadJobStatus.COMPLETED);
        expect(followUp.result).toEqual(55);
    }, 15000);

    it('fails the job with a timeout error when it does not complete in time', async () => {
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.ts');
        const res: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.runThreadJob({
            workerData: { filePath, amount: 45 },
            timeout: 1
        });

        expect(res.status).toBe(ThreadJobStatus.FAILED);
        expect(res.error?.name).toBe('TimeoutError');
    }, 15000);

    it('requeueThreadJob resets and reruns a completed job to completion again', async () => {
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.test.worker.ts');
        const jobId: string = await multithreadingService.queueThreadJob({ workerData: { filePath, amount: 10 } });
        const first: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.waitForThreadJob(jobId);
        expect(first.status).toBe(ThreadJobStatus.COMPLETED);
        expect(first.result).toEqual(55);

        const rerun: ThreadJobEntity<{ filePath: FsPath }, unknown> = await multithreadingService.rerunThreadJob(jobId);
        expect(rerun.status).toBe(ThreadJobStatus.COMPLETED);
        expect(rerun.result).toEqual(55);
    }, 15000);

    it('reportProgress updates the job entity progress while the worker is still running', async () => {
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.progress.test.worker.ts');
        const jobId: string = await multithreadingService.queueThreadJob({ workerData: { filePath } });

        await new Promise(resolve => setTimeout(resolve, 200));

        const threadJobRepo: Repository<ThreadJobEntity<BaseThreadJobWorkerData, unknown>> = inject(repositoryTokenFor(ThreadJobEntity));
        const midFlight: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await threadJobRepo.findById(jobId);
        expect(midFlight.progress).toBe(50);
        expect(midFlight.status).toBe(ThreadJobStatus.IN_PROGRESS);

        const completed: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await multithreadingService.waitForThreadJob(jobId);
        expect(completed.status).toBe(ThreadJobStatus.COMPLETED);
        expect(completed.progress).toBe(100);
        expect(completed.result).toBe('done');
    }, 15000);

    it('reportError marks the job as FAILED with the reported error', async () => {
        const filePath: FsPath = FsUtilities.getPath(__dirname, 'multithreading.service.report-error.test.worker.ts');
        const res: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = await multithreadingService.runThreadJob({ workerData: { filePath } });

        expect(res.status).toBe(ThreadJobStatus.FAILED);
        expect(res.error?.message).toContain('worker fixture: reported via reportError()');
    }, 15000);
});