import { afterAll, afterEach, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource, RoundTripCounter } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { type CronJob } from '../cron/cron-job.model';
import { type CronServiceInterface } from '../cron/cron-service.interface';
import { CronService } from '../cron/cron.service';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { type EmailServiceInterface } from '../email/email-service.interface';
import { EmailStatus } from '../email/models/email-status.enum';
import { Email } from '../email/models/email.model';
import { EmailSendResult, EmailTransportInterface } from '../email/transports/email-transport.interface';
import { type EventServiceInterface } from '../event/event-service.interface';
import { EventSubscriberRegistration } from '../event/event-subscriber-registration.model';
import { MultithreadingService } from '../multithreading/services/multithreading.service';
import { Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';

/**
 * What an idle instance costs the shared store, as calls on it.
 *
 * The application is initialized with the real cron service but never started, so nothing fires on
 * its own: the test is the clock. It moves the time a second at a time and runs every job whose
 * schedule names that second, the way node-cron would.
 */

const roundTrips: RoundTripCounter = new RoundTripCounter();

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories,
    roundTrips
});

const sentTransport: EmailTransportInterface = {
    name: 'SentEmailTransport',
    send: (): Promise<EmailSendResult> => Promise.resolve({ rejectedRecipients: [] })
};

declare module '../event/event-service.interface' {
    /**
     * What this suite emits.
     */
    interface ZibriEventMap {
        'polling.woken': Record<string, number>
    }
}

/**
 * A quiet moment on a quiet day, far from the midnight the daily jobs run at.
 */
const START: number = new Date('2026-03-04T10:00:00.000Z').getTime();

let server: StartedTestServer | undefined;
let now: number = START;

beforeAll(async () => {
    server = await startTestServer({
        dataSources: [dataSourceClass],
        providers: [
            ...defaultTestServerProviders.filter(p => p.token !== ZIBRI_DI_TOKENS.CRON_SERVICE),
            defineProvider({ token: ZIBRI_DI_TOKENS.CRON_SERVICE, useClass: CronService }),
            defineProvider({
                token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                useValue: { maxEmailsPerHour: 1000, defaultSender: 'noreply@example.com', failedRetentionInMs: 'forever' }
            }),
            defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: sentTransport }),
            defineProvider({
                token: ZIBRI_DI_TOKENS.MULTITHREADING_OPTIONS,
                useValue: {
                    maxThreads: 1,
                    maxPriorityThreads: 0,
                    defaultTimeoutInMs: Ms.MINUTE,
                    defaultPriorityTimeoutInMs: Ms.MINUTE,
                    jobClaimInMs: Ms.SECOND * 30,
                    maxAttempts: 3,
                    workerResourceLimits: {},
                    enableTsWorkerFiles: false
                }
            }),
            defineProvider({ token: ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS, useValue: 'forever' }),
            defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: MultithreadingService })
        ]
    });
    // the pool without the schedule: starting the application would put every job on node-cron's
    // timers, which the cases below stand in for
    await inject(MultithreadingService).onAppStart();
    // registered through the service, as an application that uses events does
    inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
    jest.useFakeTimers({
        now: START,
        doNotFake: [
            'nextTick',
            'setImmediate',
            'clearImmediate',
            'setInterval',
            'clearInterval',
            'setTimeout',
            'clearTimeout',
            'queueMicrotask',
            'hrtime',
            'performance'
        ]
    });
}, TestTimeouts.inMemory.start);

afterEach(() => {
    roundTrips.reset();
});

afterAll(async () => {
    jest.useRealTimers();
    await server?.shutdown();
}, TestTimeouts.inMemory.shutdown);

/**
 * Moves the clock forward a second at a time, running every job whose schedule names the second.
 * @param seconds - How long to move it.
 */
async function runFor(seconds: number): Promise<void> {
    const cronJobs: CronJob[] = inject<CronServiceInterface>(ZIBRI_DI_TOKENS.CRON_SERVICE).cronJobs;
    for (let i: number = 0; i < seconds; i++) {
        // the event loop turns between two ticks, as it does between two of node-cron's timers - which
        // is when a published message arrives
        await new Promise(resolve => setImmediate(resolve));
        now += Ms.SECOND;
        jest.setSystemTime(now);
        const at: Date = new Date(now);
        for (const job of cronJobs.filter(j => j.matches(at))) {
            await job.runOnTick(at);
        }
    }
}

describe('what an idle instance costs the store', () => {
    it('asks it fewer than ninety times a minute once the polls have found nothing for a while', async () => {
        await runFor(60);
        roundTrips.reset();

        await runFor(60);

        // every poll at most four times a minute - a send pass is seven calls of those, a dispatch
        // pass two - and the queue gauges, a dozen calls every thirty seconds. Every poll asking at
        // every tick of its schedule was 448
        expect(roundTrips.count).toBeLessThanOrEqual(90);
    }, 60000);

    it('looks at the mail queue on the next tick once a mail is queued, however long it found nothing', async () => {
        await runFor(60);
        const emailService: EmailServiceInterface = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        await emailService.queue({ html: '<p>hi</p>', subject: 'woken', recipients: ['someone@example.com'] });

        await runFor(5);

        // sent, which only a poll of the queue does
        expect(await inject(repositoryTokenFor(Email)).count({ where: { status: EmailStatus.QUEUED } })).toBe(0);
    }, 60000);

    it('looks for an event owed to a subscriber of another instance on the next tick, however long it found nothing', async () => {
        await runFor(60);
        // hosted by another instance, whose dispatch poll is the one this stands in for
        await inject(repositoryTokenFor(EventSubscriberRegistration)).create({
            subscriberId: 'elsewhere',
            eventType: 'polling.woken',
            expiresAt: new Date(now + Ms.HOUR)
        });
        const eventService: EventServiceInterface = inject(ZIBRI_DI_TOKENS.EVENT_SERVICE);
        await eventService.emit('polling.woken', {});
        roundTrips.reset();

        await runFor(5);

        // the page of due events, and the registrations it is settled against
        expect(roundTrips.describe()).toContain('EventSubscriberRegistration.find');
    }, 60000);
});