import os from 'node:os';
import path from 'node:path';
import { performance } from 'perf_hooks';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';

import { MultithreadingService } from './multithreading.service';
import { AssetService } from '../../assets';
import { Repository } from '../../data-source';
import { Logger, LoggerInterface, LoggerTransport, LogLevel } from '../../logging';
import { OmitStrict } from '../../types';
import { Ms, UUIDUtilities } from '../../utilities';
import { BaseThreadJobWorkerData, MultithreadingOptions, ThreadJobEntity } from '../models';

// minimal in-memory repository used by the service in tests
class InMemoryThreadJobRepository {
    private readonly store: Map<string, ThreadJobEntity<BaseThreadJobWorkerData, unknown>> = new Map<string, ThreadJobEntity<BaseThreadJobWorkerData, unknown>>();
    create(data: OmitStrict<ThreadJobEntity<BaseThreadJobWorkerData, unknown>, 'id'>): ThreadJobEntity<BaseThreadJobWorkerData, unknown> {
        const id: string = UUIDUtilities.generate();
        const entity: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = { ...data, id };
        this.store.set(id, entity);
        return entity;
    }
    updateById(id: string, data: Partial<ThreadJobEntity<BaseThreadJobWorkerData, unknown>>): ThreadJobEntity<BaseThreadJobWorkerData, unknown> {
        const found: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = this.findById(id);
        const updated: ThreadJobEntity<BaseThreadJobWorkerData, unknown> = { ...found, ...data };
        this.store.set(id, updated);
        return updated;
    }
    findById(id: string): ThreadJobEntity<BaseThreadJobWorkerData, unknown> {
        const found: ThreadJobEntity<BaseThreadJobWorkerData, unknown> | undefined = this.store.get(id);
        if (!found) {
            throw new Error('Not found');
        }
        return found;
    }
}

const allThreads: number = os.availableParallelism();
const reserveThreadsMain: number = 1;
const reserveThreadsLibUv: number = Number(process.env.UV_THREADPOOL_SIZE ?? '4');
const availableThreads: number = allThreads - reserveThreadsLibUv - reserveThreadsMain;

const maxThreads: number = Math.max(2, availableThreads - 1);
const maxPriorityThreads: number = availableThreads <= 1 ? 0 : 1;

const options: MultithreadingOptions = {
    maxThreads: maxThreads,
    maxPriorityThreads: maxPriorityThreads,
    defaultTimeoutMs: Ms.HOUR,
    defaultTimeoutPriorityMs: Ms.MINUTE * 5
};

const repo: Repository<ThreadJobEntity<BaseThreadJobWorkerData, unknown>> = new InMemoryThreadJobRepository() as unknown as Repository<ThreadJobEntity<BaseThreadJobWorkerData, unknown>>;
const logger: LoggerInterface = new Logger(
    [LoggerTransport.console(LogLevel.INFO)],
    {
        [LogLevel.INFO]: 1,
        [LogLevel.DEBUG]: 1,
        [LogLevel.WARN]: 1,
        [LogLevel.ERROR]: 1,
        [LogLevel.CRITICAL]: 1
    }
);
const assetService: AssetService = new AssetService(logger);
(assetService.assetsPath as unknown as string) = path.join(__dirname, '../../../sandbox/assets');

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

let multithreadingService: MultithreadingService;

describe('MultithreadingService - performance vs main event loop', () => {
    beforeAll(async () => {
        if (allThreads <= 2) {
            return;
        }
        multithreadingService = new MultithreadingService(options, repo, assetService, logger);
        await multithreadingService.init();
    }, (options.maxThreads * tSingle) * 3);
    afterAll(async () => {
        if (allThreads <= 2) {
            return;
        }
        await multithreadingService.shutdown();
    });

    it('runs CPU heavy tasks significantly faster via worker threads', async () => {
        if (allThreads <= 2) {
            return;
        }
        // measure sequential main-thread execution
        const startMain: number = performance.now();
        const mainResults: number[] = [];
        for (let i: number = 0; i < options.maxThreads; i++) {
            mainResults.push(fib(n));
        }
        const mainMs: number = performance.now() - startMain;

        // measure worker-thread execution (parallel)
        const startWorkers: number = performance.now();
        const workerPromises: Promise<number>[] = Array.from({ length: options.maxThreads }, () => multithreadingService.run(fib, n));
        const workerResults: number[] = await Promise.all(workerPromises);
        const workersMs: number = performance.now() - startWorkers;

        // basic correctness
        expect(workerResults).toEqual(mainResults);

        // assert worker run is significantly faster than main-thread sequential run
        const thresholdFactor: number = computeAdaptiveThresholdFactor(options.maxThreads, options.maxThreads);
        // eslint-disable-next-line no-console
        console.debug('threshold factor:', thresholdFactor, 'multithreading should be below:', mainMs * thresholdFactor);
        // eslint-disable-next-line no-console
        console.debug(`main: ${Math.round(mainMs)} ms, workers: ${Math.round(workersMs)} ms`);
        expect(workersMs).toBeLessThan(mainMs * thresholdFactor);
    }, (options.maxThreads * tSingle) * 2);
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