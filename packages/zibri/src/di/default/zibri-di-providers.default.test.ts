import { describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { ZIBRI_DI_TOKENS } from './zibri-di-tokens.default';
import { TestTimeouts } from '../../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../../__testing__/test-server/providers';
import { startAndStopTestServerWithout } from '../../__testing__/test-server/start-and-stop-test-server-without.function';
import { StartedTestServer, startTestServer } from '../../__testing__/test-server/start-test-server.function';
import { EmailServiceInterface } from '../../email/email-service.interface';
import { Email } from '../../email/models/email.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { EventSubscriberRegistration } from '../../event/event-subscriber-registration.model';
import { EventSubscriberRun } from '../../event/event-subscriber-run.model';
import { Event } from '../../event/event.model';
import { EventService } from '../../event/event.service';
import { ThreadJobEntity } from '../../multithreading/models/thread-job-entity.model';
import { MultithreadingService } from '../../multithreading/services/multithreading.service';
import { RateLimiterInterface } from '../../rate-limiting/limiter/rate-limiter.interface';
import { BaseRateLimitState } from '../../rate-limiting/stores/rate-limiter-store.interface';
import { inject } from '../inject.function';
import { defineProvider, DiProvider } from '../models/di-provider.model';
import { DiToken } from '../models/di-token.model';

// evaluation/round-2 08 §X17: email, events and thread jobs are building blocks every application
// sets up, so that plugins can rely on them. An application doing without one replaces its service,
// and then provides neither its options nor its entities

/**
 * An email service for an application that sends no mail.
 */
// eslint-disable-next-line cspell/spellchecker
class MaillessEmailService implements EmailServiceInterface {

    // eslint-disable-next-line typescript/require-await
    async queue(): Promise<void> {
        throw new InternalError('This application sends no mail.');
    }

    async sendQueuedEmails(): Promise<boolean> {
        return Promise.resolve(false);
    }

    async deleteExpiredFailedEmails(): Promise<number> {
        return Promise.resolve(0);
    }
}

/**
 * The event service, setting nothing up at boot.
 */
// eslint-disable-next-line cspell/spellchecker
class EventlessEventService extends EventService {

    override onAppInit(): void {}
}

/**
 * The multithreading service, setting nothing up at boot.
 */
// eslint-disable-next-line cspell/spellchecker
class ThreadlessMultithreadingService extends MultithreadingService {

    override async onAppInit(): Promise<void> {
        return Promise.resolve();
    }
}

const leftOut: DiToken<unknown>[] = [
    ZIBRI_DI_TOKENS.EMAIL_CONFIG,
    ZIBRI_DI_TOKENS.EMAIL_TRANSPORT,
    ZIBRI_DI_TOKENS.EVENT_FAILED_RETENTION_IN_MS,
    ZIBRI_DI_TOKENS.THREAD_JOB_RETENTION_IN_MS
];

describe('the default providers', () => {
    // first, for the reason on startAndStopTestServerWithout
    it('start an application without email, events and thread jobs once their services are replaced', async () => {
        const providers: DiProvider<unknown>[] = [
            ...defaultTestServerProviders.filter(provider => !leftOut.includes(provider.token)),
            // eslint-disable-next-line cspell/spellchecker
            defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_SERVICE, useClass: MaillessEmailService }),
            // eslint-disable-next-line cspell/spellchecker
            defineProvider({ token: ZIBRI_DI_TOKENS.EVENT_SERVICE, useClass: EventlessEventService }),
            // eslint-disable-next-line cspell/spellchecker
            defineProvider({ token: ZIBRI_DI_TOKENS.MULTITHREADING_SERVICE, useClass: ThreadlessMultithreadingService })
        ];

        // awaited rather than matched, so that a refused boot fails with its stack
        await startAndStopTestServerWithout(
            [Email, Event, EventSubscriberRun, EventSubscriberRegistration, ThreadJobEntity],
            { providers }
        );
    }, TestTimeouts.inMemory.start);

    it('limit the mails of an application sending them, with the email rate limiter it starts', async () => {
        const server: StartedTestServer = await startTestServer({
            dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities, repositories: defaultTestServerRepositories })]
        });
        try {
            const limiters: RateLimiterInterface<BaseRateLimitState>[] = inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE).limiters;
            expect(limiters).toContain(inject(ZIBRI_DI_TOKENS.EMAIL_RATE_LIMITER));
        }
        finally {
            await server.shutdown();
        }
    }, TestTimeouts.inMemory.start);
});