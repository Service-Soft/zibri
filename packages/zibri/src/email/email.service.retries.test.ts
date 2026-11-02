import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { EmailServiceInterface } from './email-service.interface';
import { CreateEmailData, QueueEmailData } from './models/create-email-data.model';
import { EmailConfigInput } from './models/email-config.model';
import { EmailStatus } from './models/email-status.enum';
import { Email } from './models/email.model';
import { EmailSendResult, EmailTransportInterface } from './transports/email-transport.interface';
import { TestTimeouts } from '../__testing__/constants';
import { defaultTestServerEntities, defaultTestServerRepositories } from '../__testing__/test-server/create-test-data-source.function';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { defineProvider } from '../di/models/di-provider.model';
import { Ms } from '../utilities/ms';

// in memory, so that what becomes of a mail whose send throws can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

const config: EmailConfigInput = {
    maxEmailsPerHour: 1000,
    defaultSender: 'noreply@example.com',
    maxSendAttempts: 3,
    retryDelayInMs: Ms.MINUTE,
    failedRetentionInMs: 'forever'
};

/**
 * The subjects of the mails the transport was handed, in the order it was handed them.
 */
const sent: string[] = [];

/**
 * The subjects of the mails the transport throws for, as one that cannot reach its server does.
 */
const unreachableFor: Set<string> = new Set();

/**
 * The subjects of the mails the transport holds on to, until the promise each waits for settles.
 */
const heldFor: Map<string, Promise<void>> = new Map();

const transport: EmailTransportInterface = {
    name: 'FlakyEmailTransport',
    send: async (email: Email): Promise<EmailSendResult> => {
        sent.push(email.subject);
        await heldFor.get(email.subject);
        if (unreachableFor.has(email.subject)) {
            throw new Error(`could not reach the mail server for "${email.subject}"`);
        }
        return await Promise.resolve({ rejectedRecipients: [] });
    }
};

describe('EmailService, given a mail whose send throws or hangs', () => {
    let server: StartedTestServer;
    let emailService: EmailServiceInterface;
    let emails: Repository<Email, CreateEmailData>;

    beforeAll(async () => {
        server = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_CONFIG, useValue: config }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
            ]
        });
        emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
        emails = inject(repositoryTokenFor(Email));
    }, TestTimeouts.inMemory.start);

    afterAll(async () => {
        await server?.shutdown();
    }, TestTimeouts.inMemory.shutdown);

    beforeEach(async () => {
        await emails.deleteAll({}, { acrossTenants: true });
        sent.length = 0;
        unreachableFor.clear();
        heldFor.clear();
    });

    /**
     * Queues a mail that is kept once it is sent, so what became of it can be read off its row.
     * @param subject - Its subject, which names it here.
     * @param data - Anything else it holds.
     */
    async function queue(subject: string, data: Partial<QueueEmailData> = {}): Promise<void> {
        await emailService.queue({ html: '<p>hi</p>', subject, recipients: ['someone@example.com'], persist: true, ...data });
    }

    /**
     * The row of a mail.
     * @param subject - Its subject.
     * @returns The row.
     */
    async function rowOf(subject: string): Promise<Email> {
        return await emails.findOne({ where: { subject }, acrossTenants: true });
    }

    /**
     * Makes a mail due for its next attempt now.
     * @param subject - Its subject.
     */
    async function makeDue(subject: string): Promise<void> {
        await emails.updateById((await rowOf(subject)).id, { nextAttemptAt: new Date(Date.now() - 1) }, { acrossTenants: true });
    }

    it('sends the rest of its batch, and passes over it until it is due again', async () => {
        unreachableFor.add('broken');
        await queue('broken');
        await queue('fine');
        const before: number = Date.now();

        await expect(emailService.sendQueuedEmails()).resolves.toBe(true);

        expect((await rowOf('fine')).status).toBe(EmailStatus.SENT);
        const broken: Email = await rowOf('broken');
        expect(broken.status).toBe(EmailStatus.QUEUED);
        expect(broken.attempts).toBe(1);
        expect(broken.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(before + Ms.MINUTE);
        expect(broken.nextAttemptAt?.getTime()).toBeLessThanOrEqual(Date.now() + Ms.MINUTE);
        // a mail kept no record of why its send threw
        expect(broken.error?.paragraphs.join('\n')).toContain('could not reach the mail server for "broken"');

        // not due yet, so the next pass finds nothing to send
        sent.length = 0;
        await expect(emailService.sendQueuedEmails()).resolves.toBe(false);
        expect(sent).toStrictEqual([]);
    });

    it('tries it again once it is due, waiting twice as long after each attempt', async () => {
        unreachableFor.add('broken');
        await queue('broken');
        await emailService.sendQueuedEmails();
        await makeDue('broken');
        const before: number = Date.now();

        await emailService.sendQueuedEmails();

        const broken: Email = await rowOf('broken');
        expect(broken.attempts).toBe(2);
        expect(broken.nextAttemptAt?.getTime()).toBeGreaterThanOrEqual(before + (2 * Ms.MINUTE));
        expect(broken.nextAttemptAt?.getTime()).toBeLessThanOrEqual(Date.now() + (2 * Ms.MINUTE));
    });

    it('sends it once its server can be reached again', async () => {
        unreachableFor.add('flaky');
        await queue('flaky');
        await emailService.sendQueuedEmails();
        unreachableFor.clear();
        await makeDue('flaky');

        await emailService.sendQueuedEmails();

        expect((await rowOf('flaky')).status).toBe(EmailStatus.SENT);
    });

    it('marks it FAILED after maxSendAttempts, keeps its row, and tries it no more', async () => {
        unreachableFor.add('hopeless');
        await queue('hopeless', { persist: false });
        await emailService.sendQueuedEmails();
        for (let attempt: number = 2; attempt <= 3; attempt++) {
            await makeDue('hopeless');
            await emailService.sendQueuedEmails();
        }

        const hopeless: Email = await rowOf('hopeless');
        expect(hopeless.status).toBe(EmailStatus.FAILED);
        expect(hopeless.attempts).toBe(3);
        expect(hopeless.error?.paragraphs.join('\n')).toContain('could not reach the mail server for "hopeless"');

        sent.length = 0;
        await expect(emailService.sendQueuedEmails()).resolves.toBe(false);
        expect(sent).toStrictEqual([]);
    });

    // written per mail rather than once for the pass: a process that dies while one send hangs has
    // recorded the mails that went out, so only the hanging one can go out twice
    it('writes the row of a mail as soon as its own send returns, while another of the pass is still sending', async () => {
        let release: () => void = () => undefined;
        heldFor.set('slow', new Promise<void>(resolve => {
            release = resolve;
        }));
        await queue('fast');
        await queue('slow');

        const pass: Promise<boolean> = emailService.sendQueuedEmails();
        let fast: Email | undefined;
        for (let attempt: number = 0; attempt < 100 && fast?.status !== EmailStatus.SENT; attempt++) {
            await new Promise(resolve => setTimeout(resolve, 10));
            fast = await rowOf('fast');
        }

        expect(fast?.status).toBe(EmailStatus.SENT);
        expect((await rowOf('slow')).status).toBe(EmailStatus.QUEUED);
        release();
        await pass;
    });
});

// a transport holding a pooled connection, an http agent or an sdk client needs to be told the
// application is going away, and only it knows what closing means
describe('EmailService, shutting down', () => {
    it('closes the transport it was given', async () => {
        let closed: number = 0;
        const closing: EmailTransportInterface = {
            name: 'ClosingEmailTransport',
            send: async (): Promise<EmailSendResult> => await Promise.resolve({ rejectedRecipients: [] }),
            close: () => {
                closed++;
            }
        };
        const server: StartedTestServer = await startTestServer({
            dataSources: [dataSourceClass],
            providers: [
                ...defaultTestServerProviders,
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_CONFIG, useValue: config }),
                defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: closing })
            ]
        });
        expect(closed).toBe(0);

        await server.shutdown();

        expect(closed).toBe(1);
    }, TestTimeouts.inMemory.start);
});