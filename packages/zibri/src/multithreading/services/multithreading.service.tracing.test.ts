import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { MultithreadingServiceInterface } from './multithreading-service.interface.ts';
import { MultithreadingService } from './multithreading.service.ts';
import { defaultTestServerEntities } from '../../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function.ts';
import { waitUntil } from '../../__testing__/wait-until.function.ts';
import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { TraceBufferInterface } from '../../tracing/trace-buffer.interface.ts';
import { TraceContextUtilities } from '../../tracing/trace-context.utilities.ts';
import { TraceSpanContext } from '../../tracing/trace-span-context.model.ts';
import { TraceSpanKind } from '../../tracing/trace-span-kind.enum.ts';
import { TraceSpanRecord } from '../../tracing/trace-span-record.model.ts';
import { TraceSpanStatus } from '../../tracing/trace-span-status.enum.ts';
import { TracingUtilities } from '../../tracing/tracing.utilities.ts';
import { FsPath, FsUtilities } from '../../utilities/fs.utilities.ts';
import { Ms } from '../../utilities/ms.ts';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../models/base-thread-job-worker-data.model.ts';
import { ThreadJobEntity } from '../models/thread-job-entity.model.ts';
import { ThreadJobStatus } from '../models/thread-job-status.enum.ts';

/**
 * A thread job row as the repository hands it back, for the reason multithreading.service.test.ts gives.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

// in memory, so that the spans a job is recorded as can be read without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
});

const traceContextWorkerFile: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.trace-context.test.worker.ts');

const throwingWorkerFile: FsPath = FsUtilities.getPath(import.meta.dirname, 'multithreading.service.throwing.test.worker.ts');

/**
 * Reads back the span a job was recorded as, waiting for it to be ended.
 * @param traceId - The trace the job belongs to.
 * @returns The span of the job.
 */
async function findJobSpan(traceId: string): Promise<TraceSpanRecord | undefined> {
    const buffer: TraceBufferInterface = inject(ZIBRI_DI_TOKENS.TRACE_BUFFER);
    const find: () => TraceSpanRecord | undefined = () => buffer.findSpansOfTrace(traceId).find(s => s.name === 'runThreadJob');
    await waitUntil(() => find() != undefined, 5000);
    return find();
}

describe('MultithreadingService tracing', () => {
    let server: StartedTestServer;
    let multithreadingService: MultithreadingServiceInterface;
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
                        maxPriorityThreads: 1,
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
        jobs = inject(repositoryTokenFor(ThreadJobEntity));
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    it('records a job as a span under the trace it was queued in, and hands the worker that span', async () => {
        let queuedIn: TraceSpanContext | undefined;
        const jobId: string = await TracingUtilities.trace('queueing', { root: true }, async span => {
            queuedIn = span.context;
            return await multithreadingService.queueThreadJob({ workerData: { filePath: traceContextWorkerFile } });
        });
        const finished: ThreadJobEntity<BaseThreadJobWorkerData, TraceSpanContext> = await multithreadingService.waitForThreadJob(jobId);
        if (queuedIn == undefined) {
            throw new Error('The queueing span was never started.');
        }

        const jobSpan: TraceSpanRecord | undefined = await findJobSpan(queuedIn.traceId);
        // unset rather than ok, as every span that succeeded is
        expect(jobSpan).toMatchObject({ parentSpanId: queuedIn.spanId, kind: TraceSpanKind.CONSUMER, status: TraceSpanStatus.UNSET });
        // what the worker passes on to a service it calls continues the job's span
        expect(finished.result).toMatchObject({ traceId: queuedIn.traceId, spanId: jobSpan?.spanId });
    }, 20000);

    it('records a job that another run picks up from its row under the trace stored there', async () => {
        const queuedIn: TraceSpanContext = TraceContextUtilities.resolveSpanContext(undefined);
        // what another instance queued inside a request and never got to
        const queued: AnyThreadJobEntity = await jobs.create({
            queuedAtMs: Date.now(),
            status: ThreadJobStatus.IN_QUEUE,
            priority: false,
            progress: 0,
            workerData: { filePath: traceContextWorkerFile },
            timeout: Ms.MINUTE,
            traceparent: TraceContextUtilities.resolveTraceparent(queuedIn)
        });

        // outside every trace, the way the poll runs it
        await multithreadingService.startQueuedJobs();
        await waitUntil(async () => (await jobs.findById(queued.id)).status === ThreadJobStatus.COMPLETED, 15000);

        expect(await findJobSpan(queuedIn.traceId)).toMatchObject({ parentSpanId: queuedIn.spanId });
    }, 20000);

    it('records a function run under the trace of its caller', async () => {
        let calledIn: TraceSpanContext | undefined;
        await TracingUtilities.trace('calling', { root: true }, async span => {
            calledIn = span.context;
            return await multithreadingService.run((n: number) => n * 2, 21);
        });
        if (calledIn == undefined) {
            throw new Error('The calling span was never started.');
        }

        expect(await findJobSpan(calledIn.traceId)).toMatchObject({ parentSpanId: calledIn.spanId, status: TraceSpanStatus.UNSET });
    }, 20000);

    it('records a job that failed as a span that failed', async () => {
        let queuedIn: TraceSpanContext | undefined;
        const jobId: string = await TracingUtilities.trace('queueing', { root: true }, async span => {
            queuedIn = span.context;
            return await multithreadingService.queueThreadJob({ workerData: { filePath: throwingWorkerFile } });
        });
        await multithreadingService.waitForThreadJob(jobId);
        if (queuedIn == undefined) {
            throw new Error('The queueing span was never started.');
        }

        expect(await findJobSpan(queuedIn.traceId)).toMatchObject({ status: TraceSpanStatus.ERROR });
    }, 20000);

    it('starts a trace of its own for a job queued outside any', async () => {
        const jobId: string = await multithreadingService.queueThreadJob({ workerData: { filePath: traceContextWorkerFile } });
        const finished: ThreadJobEntity<BaseThreadJobWorkerData, TraceSpanContext> = await multithreadingService.waitForThreadJob(jobId);
        if (finished.result == undefined) {
            throw new Error('The worker was handed no trace context.');
        }

        const jobSpan: TraceSpanRecord | undefined = await findJobSpan(finished.result.traceId);
        expect(jobSpan?.spanId).toBe(finished.result.spanId);
        expect(jobSpan?.parentSpanId ?? undefined).toBeUndefined();
    }, 20000);
});