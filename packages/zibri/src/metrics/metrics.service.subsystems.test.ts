import { Readable } from 'node:stream';

import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { InMemoryDataSource } from 'zibri-testing';

import { MetricsExposition } from './metrics-exposition.model';
import { MetricsServiceInterface, MetricsSnapshot } from './metrics-service.interface';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { CronExpression, CronExpressionString } from '../cron/cron-expression.utilities';
import { CronJobEntity } from '../cron/cron-job-entity.model';
import { CronJob, InitialCronConfig } from '../cron/cron-job.model';
import { CronService } from '../cron/cron.service';
import { DataSource } from '../data-source/decorators/data-source.decorator';
import { Repository } from '../data-source/repository/repository';
import { RepositoryClass } from '../data-source/repository/repository-class.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { type EmailServiceInterface } from '../email/email-service.interface';
import { EmailSendResult, EmailTransportInterface } from '../email/transports/email-transport.interface';
import { BaseEntity } from '../entity/base-entity.model';
import { Event, EventCreateData, EventStatus } from '../event/event.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { BaseFunctionThreadJobWorkerData, BaseThreadJobWorkerData } from '../multithreading/models/base-thread-job-worker-data.model';
import { ThreadJobEntity } from '../multithreading/models/thread-job-entity.model';
import { ThreadJobStatus } from '../multithreading/models/thread-job-status.enum';
import { MultithreadingService } from '../multithreading/services/multithreading.service';
import { Response } from '../open-api/decorators/response.decorator';
import { FileResponse } from '../parsing/form-data/file-response.model';
import { Controller } from '../routing/decorators/controller.decorator';
import { Get } from '../routing/decorators/get.decorator';
import { Newable } from '../types/newable.type';
import { FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

/**
 * A thread job row as the repository hands it back.
 */
type AnyThreadJobEntity = ThreadJobEntity<BaseThreadJobWorkerData | BaseFunctionThreadJobWorkerData<unknown>, unknown>;

/**
 * What a scrape asks for, written the way the metrics docs show it.
 */
@Controller('/metrics-subsystems-test')
class ScrapeController {
    @Response.file()
    @Get('/scrape')
    async scrape(): Promise<FileResponse> {
        const exposition: MetricsExposition = await inject(ZIBRI_DI_TOKENS.METRICS_SERVICE).resolveExposition();
        return FileResponse.fromStream({ stream: Readable.from([exposition.body]), filename: 'metrics.txt', mimeType: exposition.contentType });
    }
}

const unreachableTransport: EmailTransportInterface = {
    name: 'UnreachableEmailTransport',
    send: (): Promise<EmailSendResult> => Promise.reject(new Error('the mail server cannot be reached'))
};

/**
 * Collects a snapshot and hands it back.
 * @param metricsService - The service to collect with.
 * @returns The snapshot.
 */
async function collectSnapshot(metricsService: MetricsServiceInterface): Promise<MetricsSnapshot> {
    await metricsService.collect();
    const snapshot: MetricsSnapshot | undefined = metricsService.getMetricSnapshots().at(-1);
    if (snapshot == undefined) {
        throw new Error('collecting left no snapshot');
    }
    return snapshot;
}

/**
 * The value of one series of a snapshot.
 * @param snapshot - The snapshot.
 * @param name - The name of the metric.
 * @param labels - The labels of the series.
 * @returns The value, or undefined when the snapshot has no such series.
 */
function valueOf(snapshot: MetricsSnapshot, name: string, labels: Record<string, string> = {}): number | undefined {
    return snapshot.metrics
        .find(m => m.name === name && Object.entries(labels).every(([key, value]) => m.labels[key] === value))
        ?.value;
}

describe('PrometheusMetricsService — the queues', () => {
    let server: StartedTestServer;
    let baseUrl: string;
    let metricsService: MetricsServiceInterface;

    beforeAll(async () => {
        @DataSource({ allowOrphan: true })
        class QueuesDataSource extends InMemoryDataSource {
            override readonly entities: Newable<BaseEntity>[] = defaultTestServerEntities;
            readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
        }
        server = await startTestServer({
            dataSources: [QueuesDataSource],
            controllers: [ScrapeController],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({
                    token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                    useValue: { maxEmailsPerHour: 1000, defaultSender: 'noreply@example.com', failedRetentionInMs: 'forever' }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: unreachableTransport }),
                defineProvider({
                    token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
                    useValue: {
                        maxThreads: 1,
                        maxPriorityThreads: 0,
                        defaultTimeoutMs: Ms.MINUTE,
                        defaultTimeoutPriorityMs: Ms.MINUTE,
                        jobClaimInMs: Ms.SECOND * 30,
                        maxAttempts: 3,
                        workerResourceLimits: {},
                        enableTsWorkerFiles: false
                    }
                }),
                defineProvider({ token: ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS, useValue: 'forever' }),
                defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService }),
                // so the log entries of the case about dropping them overflow it
                defineProvider({ token: ZIBRI_DI_TOKENS.LOGGER_BUFFER_CAPACITY, useValue: 50 })
            ]
        });
        // started before any row is planted: the pool reads the queue once on start, and the rows
        // below are for counting rather than for running
        baseUrl = await server.start();
        metricsService = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('reports how deep each queue is and how old its oldest item is, refreshed at most every 30 seconds', async () => {
        const emailService: EmailServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        for (let i: number = 0; i < 3; i++) {
            await emailService.queue({ html: '<p>hi</p>', subject: `queued ${i}`, recipients: ['someone@example.com'] });
        }
        // every send throws, so the mails stay queued with an attempt counted
        await emailService.sendQueuedEmails();

        const events: Repository<Event<unknown>, EventCreateData<unknown>> = inject(repositoryTokenFor(Event));
        const event: Omit<EventCreateData<unknown>, 'tenantId'> = {
            type: 'metrics.test',
            data: {},
            cleanupAt: new Date(Date.now() + Ms.DAY),
            subscriberIds: ['metrics-test']
        };
        await events.create(event);
        await events.create(event);
        const failed: Event<unknown> = await events.create(event);
        await events.updateById(failed.id, { status: EventStatus.FAILED });

        const jobs: Repository<AnyThreadJobEntity> = inject(repositoryTokenFor(ThreadJobEntity));
        const job: Omit<AnyThreadJobEntity, 'id' | 'status' | 'tenantId'> = {
            queuedAtMs: Date.now() - (10 * Ms.MINUTE),
            progress: 0,
            attempts: 0,
            priority: false,
            timeout: Ms.MINUTE,
            workerData: { filePath: FsUtilities.getPath('nowhere.js') }
        };
        await jobs.create({ ...job, status: ThreadJobStatus.IN_QUEUE });
        await jobs.create({ ...job, status: ThreadJobStatus.IN_QUEUE });
        await jobs.create({ ...job, status: ThreadJobStatus.FAILED, attempts: 3 });

        const snapshot: MetricsSnapshot = await collectSnapshot(metricsService);

        expect(valueOf(snapshot, 'email_queue_depth', { status: 'QUEUED' })).toBe(3);
        expect(valueOf(snapshot, 'email_queue_depth', { status: 'FAILED' })).toBe(0);
        expect(valueOf(snapshot, 'email_queue_oldest_age_seconds')).toBeGreaterThanOrEqual(0);
        expect(valueOf(snapshot, 'event_queue_depth', { status: 'CREATED' })).toBe(2);
        expect(valueOf(snapshot, 'event_queue_depth', { status: 'FAILED' })).toBe(1);
        expect(valueOf(snapshot, 'event_queue_oldest_age_seconds')).toBeGreaterThanOrEqual(0);
        expect(valueOf(snapshot, 'thread_job_queue_depth', { status: 'IN_QUEUE' })).toBe(2);
        expect(valueOf(snapshot, 'thread_job_queue_depth', { status: 'FAILED' })).toBe(1);
        expect(valueOf(snapshot, 'thread_job_queue_oldest_age_seconds')).toBeGreaterThanOrEqual(10 * 60);

        // counted again only once the interval passed, so collecting every few seconds on every
        // instance does not count the tables every few seconds
        await emailService.queue({ html: '<p>hi</p>', subject: 'queued later', recipients: ['someone@example.com'] });
        expect(valueOf(await collectSnapshot(metricsService), 'email_queue_depth', { status: 'QUEUED' })).toBe(3);
    });

    it('reports how many workers are busy and how many are idle', async () => {
        const snapshot: MetricsSnapshot = await collectSnapshot(metricsService);

        expect(valueOf(snapshot, 'thread_workers', { state: 'busy' })).toBe(0);
        expect(valueOf(snapshot, 'thread_workers', { state: 'idle' })).toBe(1);
    });

    it('counts the log entries dropped because the write queue was full', async () => {
        const logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER);
        await logger.flush();
        const before: number = valueOf(await collectSnapshot(metricsService), 'log_entries_dropped_total') ?? 0;

        for (let i: number = 0; i < 200; i++) {
            logger.info(`entry ${i}`);
        }
        await logger.flush();

        const after: number = valueOf(await collectSnapshot(metricsService), 'log_entries_dropped_total') ?? 0;
        expect(after - before).toBeGreaterThanOrEqual(150);
    });

    it('answers a scrape in the text exposition format', async () => {
        const res: Response = await fetch(`${baseUrl}/metrics-subsystems-test/scrape`);

        expect(res.status).toBe(200);
        expect(res.headers.get('content-type')).toMatch(/^text\/plain; version=0\.0\.4/);
        const body: string = await res.text();
        expect(body).toContain('# TYPE http_requests_total counter');
        expect(body).toMatch(/^email_queue_depth{status="QUEUED"} \d+$/m);
    });
});

/**
 * Once a year, so no tick of its own fires while the cases run.
 */
const YEARLY: CronExpressionString = CronExpression.fromString('0 0 0 1 1 *');

class SucceedingCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = { name: 'metrics succeeding', cron: YEARLY, timezone: 'UTC' };

    override onTick(): void {
        // nothing to do, and done
    }
}

class FailingCronJob extends CronJob {
    readonly initialConfig: InitialCronConfig = { name: 'metrics failing', cron: YEARLY, timezone: 'UTC' };

    override onTick(): void {
        throw new Error('a scripted failure');
    }
}

describe('PrometheusMetricsService — cron jobs', () => {
    let server: StartedTestServer;
    let metricsService: MetricsServiceInterface;

    beforeAll(async () => {
        @DataSource({ allowOrphan: true })
        class CronJobsDataSource extends InMemoryDataSource {
            override readonly entities: Newable<BaseEntity>[] = [...defaultTestServerEntities, CronJobEntity];
            readonly repositories: RepositoryClass[] = defaultTestServerRepositories;
        }
        server = await startTestServer({
            dataSources: [CronJobsDataSource],
            // declared by this file, so every server it starts has to name it
            controllers: [ScrapeController],
            cronJobs: [SucceedingCronJob, FailingCronJob],
            providers: [
                ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
                defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService })
            ]
        });
        await server.start();
        metricsService = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    it('reports every job from the start, before it ran', async () => {
        const snapshot: MetricsSnapshot = await collectSnapshot(metricsService);

        expect(valueOf(snapshot, 'cron_job_runs_total', { job: 'metrics succeeding' })).toBe(0);
        expect(valueOf(snapshot, 'cron_job_failures_total', { job: 'metrics succeeding' })).toBe(0);
    });

    it('counts the runs of each job, and the ones that failed', async () => {
        await inject(SucceedingCronJob).runOnTick();
        await inject(FailingCronJob).runOnTick();
        await inject(FailingCronJob).runOnTick();

        const snapshot: MetricsSnapshot = await collectSnapshot(metricsService);

        expect(valueOf(snapshot, 'cron_job_runs_total', { job: 'metrics succeeding' })).toBe(1);
        expect(valueOf(snapshot, 'cron_job_failures_total', { job: 'metrics succeeding' })).toBe(0);
        expect(valueOf(snapshot, 'cron_job_runs_total', { job: 'metrics failing' })).toBe(2);
        expect(valueOf(snapshot, 'cron_job_failures_total', { job: 'metrics failing' })).toBe(2);
        expect(valueOf(snapshot, 'cron_job_duration_ms_count', { job: 'metrics failing' })).toBe(2);
    });
});