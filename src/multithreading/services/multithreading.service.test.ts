import os from 'node:os';
import { performance } from 'perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { MultithreadingServiceInterface } from './multithreading-service.interface';
import { MultithreadingService } from './multithreading.service';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities';
import { Ms } from '../../utilities/ms';
import { ThreadJobEntity } from '../models/thread-job-entity.model';

const allThreads: number = os.availableParallelism();
const reserveThreadsMain: number = 1;
const reserveThreadsLibUv: number = Number(process.env.UV_THREADPOOL_SIZE ?? '4');
const availableThreads: number = allThreads - reserveThreadsLibUv - reserveThreadsMain;

const maxThreads: number = Math.max(2, availableThreads - 1);
const maxPriorityThreads: number = availableThreads <= 1 ? 0 : 1;

function fib(n: number): number {
    if (n < 2) {
        return n;
    }
    return fib(n - 1) + fib(n - 2);
}

const n: number = 40; // fib input (tune this up if your machine is very fast/slow)
// warm-up
const warmStart: number = performance.now();
fib(n);
const tSingle: number = performance.now() - warmStart;

let multithreadingService: MultithreadingServiceInterface;
let server: StartedTestServer | undefined;

describe('MultithreadingService - performance vs main event loop', () => {
    beforeAll(async () => {
        if (allThreads <= 2) {
            return;
        }
        // eslint-disable-next-line no-console
        console.debug('allThreads', allThreads);
        server = await startTestServer({
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
                    useValue: {
                        maxThreads: maxThreads,
                        maxPriorityThreads: maxPriorityThreads,
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
        if (allThreads <= 2) {
            return;
        }
        await server?.shutdown();
    });

    it('runs CPU heavy tasks significantly faster via worker threads', async () => {
        if (allThreads <= 2) {
            return;
        }
        // measure sequential main-thread execution
        const startMain: number = performance.now();
        const mainResults: number[] = [];
        for (let i: number = 0; i < maxThreads; i++) {
            mainResults.push(fib(n));
        }
        const mainMs: number = performance.now() - startMain;

        // measure worker-thread execution (parallel)
        const startWorkers: number = performance.now();
        const workerPromises: Promise<number>[] = Array.from({ length: maxThreads }, async () => await multithreadingService.run(fib, n));
        const workerResults: number[] = await Promise.all(workerPromises);
        const workersMs: number = performance.now() - startWorkers;

        // basic correctness
        expect(workerResults).toEqual(mainResults);

        // assert worker run is significantly faster than main-thread sequential run
        const thresholdFactor: number = computeAdaptiveThresholdFactor(maxThreads, maxThreads);
        // eslint-disable-next-line no-console
        console.debug('threshold factor:', thresholdFactor, 'multithreading should be below:', mainMs * thresholdFactor);
        // eslint-disable-next-line no-console
        console.debug(`main: ${Math.round(mainMs)} ms, workers: ${Math.round(workersMs)} ms`);
        expect(workersMs).toBeLessThan(mainMs * thresholdFactor);
    }, (maxThreads * tSingle) * 2);

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
});

export function computeAdaptiveThresholdFactor(
    tasks: number,
    threads: number,
    slack: number = 2
): number {
    const idealFactor: number = Math.ceil(tasks / Math.max(1, threads)) / Math.max(1, tasks);
    const thresholdFactor: number = idealFactor * slack;
    return thresholdFactor;
}