import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import { createInMemoryDataSource, InMemoryDataSource } from 'zibri-testing';

import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { type CronJob } from '../cron/cron-job.model';
import { type CronServiceInterface } from '../cron/cron-service.interface';
import { CronService } from '../cron/cron.service';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { EmailPriority } from '../email/models/email-priority.enum';
import { EmailStatus } from '../email/models/email-status.enum';
import { Email } from '../email/models/email.model';
import { EmailSendResult, EmailTransportInterface } from '../email/transports/email-transport.interface';
import { Newable } from '../types/newable.type';
import { Ms } from '../utilities/ms';

// an idle poll waited up to 30 seconds, whatever the
// application needed

/**
 * How long an idle poll waits at most in this application.
 */
const MAX_INTERVAL_IN_MS: number = Ms.SECOND * 5;

const dataSourceClass: Newable<InMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

const sentTransport: EmailTransportInterface = {
    name: 'SentEmailTransport',
    send: (): Promise<EmailSendResult> => Promise.resolve({ rejectedRecipients: [] })
};

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
            defineProvider({ token: ZIBRI_DI_TOKENS.POLL_MAX_INTERVAL_IN_MS, useValue: MAX_INTERVAL_IN_MS })
        ]
    });
    // the jobs without the schedule: the case below is the clock, as in polling-cron-job.costs.test.ts
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
        await new Promise(resolve => setImmediate(resolve));
        now += Ms.SECOND;
        jest.setSystemTime(now);
        const at: Date = new Date(now);
        for (const job of cronJobs.filter(j => j.matches(at))) {
            await job.runOnTick(at);
        }
    }
}

describe('an idle poll in an application that shortens the longest wait', () => {
    it('finds work nobody announced within that wait', async () => {
        await runFor(60);
        // written past the email service, so nothing wakes the poll: what an instance that stopped
        // existing leaves behind looks like this
        const emails: Repository<Email> = inject(repositoryTokenFor(Email));
        await emails.create({
            html: '<p>hi</p>',
            subject: 'unannounced',
            recipients: ['someone@example.com'],
            sender: 'noreply@example.com',
            status: EmailStatus.QUEUED,
            priority: EmailPriority.NORMAL,
            persist: false
        });

        await runFor((MAX_INTERVAL_IN_MS / Ms.SECOND) + 1);

        expect(await emails.count({ where: { status: EmailStatus.QUEUED } })).toBe(0);
    }, 60000);
});