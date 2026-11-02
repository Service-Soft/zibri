import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { EmailServiceInterface } from './email-service.interface';
import { EmailConfigInput } from './models/email-config.model';
import { EmailPriority } from './models/email-priority.enum';
import { Email } from './models/email.model';
import { EmailSendResult, EmailTransportInterface } from './transports/email-transport.interface';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider, DiProvider } from '../di/models/di-provider.model';

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

/**
 * The mails the transport was handed.
 */
const sent: Email[] = [];

const transport: EmailTransportInterface = {
    name: 'RecordingEmailTransport',
    send: (email: Email): Promise<EmailSendResult> => {
        sent.push(email);
        return Promise.resolve({ rejectedRecipients: [] });
    }
};

/**
 * The providers of an application sending mail under the given configuration.
 * @param config - The configuration.
 * @returns The providers.
 */
function resolveProviders(config: EmailConfigInput): DiProvider<unknown>[] {
    return [
        ...defaultTestServerProviders,
        defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_CONFIG, useValue: config }),
        defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
    ];
}

// a pass asks the rate limiter for its whole batch at once, and a bucket holding
// fewer tokens than that never grants it - so the queue was refused on every pass, for good
describe('EmailService - a batch larger than the hourly limit', () => {
    describe('with the default batch', () => {
        let server: StartedTestServer;
        let emailService: EmailServiceInterface;

        beforeAll(async () => {
            server = await startTestServer({
                dataSources: [dataSourceClass],
                providers: resolveProviders({ maxEmailsPerHour: 5, defaultSender: 'noreply@example.com', failedRetentionInMs: 'forever' })
            });
            emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        }, TestTimeouts.inMemory.start);

        afterAll(async () => {
            await server?.shutdown();
        }, TestTimeouts.inMemory.shutdown);

        it('sends within the limit rather than nothing', async () => {
            for (let i: number = 0; i < 10; i++) {
                await emailService.queue({ html: '<p>hi</p>', subject: `mail ${i}`, recipients: ['someone@example.com'] });
            }

            for (let pass: number = 0; pass < 3; pass++) {
                await emailService.sendQueuedEmails();
            }

            // a slot of the five held back for a LOW mail, of which there is none
            expect(sent.length).toBeGreaterThan(0);
            expect(sent.length).toBeLessThanOrEqual(5);
        });
    });

    // found while fixing it: a batch held back a slot for every lower priority, so one smaller than
    // the three priorities left the higher ones none - and the cap above makes such a batch the
    // default of an application sending one or two mails an hour
    describe('of one mail', () => {
        let server: StartedTestServer;
        let emailService: EmailServiceInterface;

        beforeAll(async () => {
            sent.length = 0;
            server = await startTestServer({
                dataSources: [dataSourceClass],
                providers: resolveProviders({ maxEmailsPerHour: 1, defaultSender: 'noreply@example.com', failedRetentionInMs: 'forever' })
            });
            emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        }, TestTimeouts.inMemory.start);

        afterAll(async () => {
            await server?.shutdown();
        }, TestTimeouts.inMemory.shutdown);

        it('sends the most urgent mail queued', async () => {
            await emailService.queue({ html: '<p>hi</p>', subject: 'normal', recipients: ['someone@example.com'] });
            await emailService.queue({ html: '<p>hi</p>', subject: 'low', recipients: ['someone@example.com'], priority: EmailPriority.LOW });
            await emailService.queue({ html: '<p>hi</p>', subject: 'high', recipients: ['someone@example.com'], priority: EmailPriority.HIGH });

            await emailService.sendQueuedEmails();

            expect(sent.map(email => email.subject)).toEqual(['high']);
        });
    });

    it('is refused at boot when the application sets it', async () => {
        await expect(startTestServer({
            dataSources: [dataSourceClass],
            providers: resolveProviders({
                maxEmailsPerHour: 5,
                sendBatchSize: 10,
                defaultSender: 'noreply@example.com',
                failedRetentionInMs: 'forever'
            })
        })).rejects.toThrow('sendBatchSize of 10 is more than the maxEmailsPerHour of 5');
    }, TestTimeouts.inMemory.start);
});