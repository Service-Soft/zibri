import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { EmailServiceInterface } from './email-service.interface.ts';
import { CreateEmailData, QueueEmailData } from './models/create-email-data.model.ts';
import { EmailConfigInput } from './models/email-config.model.ts';
import { EmailStatus } from './models/email-status.enum.ts';
import { Email } from './models/email.model.ts';
import { EmailSendResult, EmailTransportInterface } from './transports/email-transport.interface.ts';
import { defaultTestServerEntities } from '../__testing__/test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../__testing__/test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../__testing__/test-server/start-test-server.function.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { defineProvider } from '../di/models/di-provider.model.ts';
import { FsUtilities } from '../utilities/fs.utilities.ts';
import { Ms } from '../utilities/ms.ts';

// in memory, so that what becomes of a mail whose send throws can be watched without a container
const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities
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

const transport: EmailTransportInterface = {
    name: 'FlakyEmailTransport',
    send: async (email: Email): Promise<EmailSendResult> => {
        sent.push(email.subject);
        if (unreachableFor.has(email.subject)) {
            throw new Error(`could not reach the mail server for "${email.subject}"`);
        }
        return await Promise.resolve({ rejectedRecipients: [] });
    }
};

describe('EmailService, given a mail whose send throws', () => {
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
    }, 30000);

    afterAll(async () => {
        await server?.shutdown();
    }, 15000);

    beforeEach(async () => {
        await emails.deleteAll({}, { acrossTenants: true });
        sent.length = 0;
        unreachableFor.clear();
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
        await emails.updateById((await rowOf(subject)).id, { retryAt: new Date(Date.now() - 1) }, { acrossTenants: true });
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
        expect(broken.retryAt?.getTime()).toBeGreaterThanOrEqual(before + Ms.MINUTE);
        expect(broken.retryAt?.getTime()).toBeLessThanOrEqual(Date.now() + Ms.MINUTE);

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
        expect(broken.retryAt?.getTime()).toBeGreaterThanOrEqual(before + (2 * Ms.MINUTE));
        expect(broken.retryAt?.getTime()).toBeLessThanOrEqual(Date.now() + (2 * Ms.MINUTE));
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

        sent.length = 0;
        await expect(emailService.sendQueuedEmails()).resolves.toBe(false);
        expect(sent).toStrictEqual([]);
    });

    it('counts a missing attachment as an attempt, rather than failing the pass', async () => {
        await queue('missing attachment', { attachments: [{ filename: 'gone.pdf', path: FsUtilities.getPath('/nonexistent/gone.pdf') }] });
        await queue('fine');

        await expect(emailService.sendQueuedEmails()).resolves.toBe(true);

        expect((await rowOf('fine')).status).toBe(EmailStatus.SENT);
        expect((await rowOf('missing attachment')).attempts).toBe(1);
    });
});