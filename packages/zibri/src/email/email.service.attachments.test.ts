import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createInMemoryDataSource } from 'zibri-testing';

import { EmailServiceInterface } from './email-service.interface';
import { CreateEmailData, QueueEmailData } from './models/create-email-data.model';
import { EmailAttachment } from './models/email-attachment.model';
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

const dataSourceClass: ReturnType<typeof createInMemoryDataSource> = createInMemoryDataSource({
    entities: defaultTestServerEntities,
    repositories: defaultTestServerRepositories
});

const config: EmailConfigInput = {
    maxEmailsPerHour: 1000,
    defaultSender: 'noreply@example.com',
    retryDelayInMs: Ms.MINUTE,
    failedRetentionInMs: 'forever'
};

/**
 * The mails the transport was handed, in the order it was handed them.
 */
const sent: Email[] = [];

const transport: EmailTransportInterface = {
    name: 'RecordingEmailTransport',
    send: (email: Email): Promise<EmailSendResult> => {
        sent.push(email);
        return Promise.resolve({ rejectedRecipients: [] });
    }
};

describe('EmailService — attachments', () => {
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

    it('keeps the content of an attachment on the row, and hands it to the transport from there', async () => {
        // what the sending instance reads is the row and nothing else, so whichever instance sends
        // the mail has the content - the one that queued it may be gone by then
        const invoice: EmailAttachment = { filename: 'invoice.pdf', base64Content: Buffer.from('%PDF invoice 42').toString('base64') };
        await queue('with attachment', { attachments: [invoice] });

        expect((await rowOf('with attachment')).attachments).toEqual([invoice]);

        await expect(emailService.sendQueuedEmails()).resolves.toBe(true);

        expect(sent[0]?.attachments).toEqual([invoice]);
        expect(Buffer.from(sent[0]?.attachments?.[0]?.base64Content ?? '', 'base64').toString('utf8')).toBe('%PDF invoice 42');
        expect((await rowOf('with attachment')).status).toBe(EmailStatus.SENT);
    });

    it('sends a mail without attachments', async () => {
        await queue('without attachments');

        await emailService.sendQueuedEmails();

        expect((await rowOf('without attachments')).status).toBe(EmailStatus.SENT);
    });

    it('sends a mail with an empty list of attachments', async () => {
        await queue('empty attachments', { attachments: [] });

        await emailService.sendQueuedEmails();

        expect((await rowOf('empty attachments')).status).toBe(EmailStatus.SENT);
    });
});