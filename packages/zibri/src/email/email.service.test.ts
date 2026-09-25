import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { EmailServiceInterface } from './email-service.interface';
import { CreateEmailData, QueueEmailData } from './models/create-email-data.model';
import { EmailConfig } from './models/email-config.model';
import { EmailPriority } from './models/email-priority.enum';
import { EmailStatus } from './models/email-status.enum';
import { Email } from './models/email.model';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { EmailSendResult, EmailTransportInterface } from './transports/email-transport.interface';
import { FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';

// ---------- The transport under the real service ----------

// The service itself is the framework's own, unmodified. It used to be subclassed here so that
// `protected send` could be replaced, which meant these tests exercised a send this file had written
// rather than the one that ships - and the override had drifted: it never wrote `rejectedRecipients`
// and deleted a failed mail the real one keeps.
// eslint-disable-next-line typescript/typedef
const mockSend = jest.fn<(email: Email) => Promise<EmailSendResult>>();

const testTransport: EmailTransportInterface = {
    name: 'TestEmailTransport',
    send: async (email: Email) => await mockSend(email)
};

const testConfig: EmailConfig = {
    maxEmailsPerHour: 1000,
    defaultSender: 'noreply@example.com',
    sendLeaseInMs: Ms.MINUTE,
    sendBatchSize: 10
};

// ---------- Helpers ----------

function accepted(): EmailSendResult {
    return { rejectedRecipients: [] };
}

function makeQueueData(overrides: Partial<QueueEmailData> = {}): QueueEmailData {
    return {
        html: '<p>Hello</p>',
        subject: 'Test subject',
        recipients: ['recipient@example.com'],
        ...overrides
    } as QueueEmailData;
}

// ---------- Test setup ----------

let server: StartedTestServer;
let emailService: EmailServiceInterface;
let emailRepo: Repository<Email, CreateEmailData>;

beforeAll(async () => {
    server = await startTestServer({
        providers: [
            ...defaultTestServerProviders,
            { token: ZIBRI_DI_TOKENS.EMAIL_CONFIG, useValue: testConfig },
            { token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: testTransport }
        ]
    });
    await server.start();

    emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
    emailRepo = inject(repositoryTokenFor(Email));
}, 15000);

afterAll(async () => {
    await server.shutdown();
}, 15000);

beforeEach(async () => {
    await emailRepo.deleteAll({});
    mockSend.mockReset();
    mockSend.mockResolvedValue(accepted());
});

// ---------- Tests ----------

describe('EmailService.queue', () => {
    it('creates an email with QUEUED status', async () => {
        await emailService.queue(makeQueueData());

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails).toHaveLength(1);
        expect(emails[0]?.status).toBe(EmailStatus.QUEUED);
    });

    it('defaults to NORMAL priority', async () => {
        await emailService.queue(makeQueueData());

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0]?.priority).toBe(EmailPriority.NORMAL);
    });

    it('respects provided priority', async () => {
        await emailService.queue(makeQueueData({ priority: EmailPriority.HIGH }));

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0]?.priority).toBe(EmailPriority.HIGH);
    });

    it('defaults to defaultSender from config when no sender provided', async () => {
        await emailService.queue(makeQueueData());

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0]?.sender).toBe(testConfig.defaultSender);
    });

    it('respects provided sender', async () => {
        await emailService.queue(makeQueueData({ sender: 'custom@example.com' }));

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0]?.sender).toBe('custom@example.com');
    });

    it('defaults persist to false', async () => {
        await emailService.queue(makeQueueData());

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0]?.persist).toBe(false);
    });

    it('respects provided persist flag', async () => {
        await emailService.queue(makeQueueData({ persist: true }));

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0]?.persist).toBe(true);
    });
});

describe('EmailService.sendQueuedEmails', () => {
    afterEach(() => void jest.restoreAllMocks());

    it('returns false and sends nothing when no emails are queued', async () => {
        const result: boolean = await emailService.sendQueuedEmails();

        expect(result).toBe(false);
        expect(mockSend).not.toHaveBeenCalled();
    });

    it('returns true after sending emails (indicating there may be more)', async () => {
        await emailService.queue(makeQueueData());

        const result: boolean = await emailService.sendQueuedEmails();

        expect(result).toBe(true);
        expect(mockSend).toHaveBeenCalledTimes(1);
    });

    it('deletes email after sending when persist is false', async () => {
        await emailService.queue(makeQueueData({ persist: false }));

        await emailService.sendQueuedEmails();

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails).toHaveLength(0);
    });

    it('updates email status to SENT when persist is true', async () => {
        await emailService.queue(makeQueueData({ persist: true }));

        await emailService.sendQueuedEmails();

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails).toHaveLength(1);
        expect(emails[0]?.status).toBe(EmailStatus.SENT);
    });

    it('updates email status to FAILED when the send is rejected', async () => {
        mockSend.mockResolvedValue({ rejectedRecipients: ['recipient@example.com'] });
        await emailService.queue(makeQueueData({ persist: true }));

        await emailService.sendQueuedEmails();

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0]?.status).toBe(EmailStatus.FAILED);
        // read off the row rather than off the transport's answer, so this covers the write the
        // subclass this file used to carry had quietly stopped doing
        expect(emails[0]?.rejectedRecipients).toEqual(['recipient@example.com']);
    });

    it('sends HIGH priority emails before NORMAL and LOW', async () => {
        // Queue in reverse priority order to ensure ordering is by priority, not insertion
        await emailService.queue(makeQueueData({ priority: EmailPriority.LOW, subject: 'low' }));
        await emailService.queue(makeQueueData({ priority: EmailPriority.NORMAL, subject: 'normal' }));
        await emailService.queue(makeQueueData({ priority: EmailPriority.HIGH, subject: 'high' }));

        // the transport is where the order is visible now. It used to be a spy on the service's own
        // protected send, which meant asserting the order of a call this file had replaced
        const sent: Email[] = [];
        mockSend.mockImplementation((email: Email) => {
            sent.push(email);
            return Promise.resolve(accepted());
        });

        await emailService.sendQueuedEmails();

        expect(sent[0]?.priority).toBe(EmailPriority.HIGH);
        expect(sent[1]?.priority).toBe(EmailPriority.NORMAL);
        expect(sent[2]?.priority).toBe(EmailPriority.LOW);
    });

    it('sends at most 10 emails per batch across all priorities', async () => {
        // Need all three priorities to fill 10 slots: HIGH(8) + NORMAL(1 reserved) + LOW(1 reserved)
        for (let i: number = 0; i < 10; i++) {
            await emailService.queue(makeQueueData({ priority: EmailPriority.HIGH, subject: `High ${i}` }));
        }
        for (let i: number = 0; i < 5; i++) {
            await emailService.queue(makeQueueData({ priority: EmailPriority.NORMAL, subject: `Normal ${i}` }));
        }
        for (let i: number = 0; i < 5; i++) {
            await emailService.queue(makeQueueData({ priority: EmailPriority.LOW, subject: `Low ${i}` }));
        }

        await emailService.sendQueuedEmails();

        // 8 high + 1 normal + 1 low = 10 (normal is capped at 10 - 1 - highCount)
        expect(mockSend).toHaveBeenCalledTimes(10);
    });

    it('sends at most 8 HIGH priority emails per batch', async () => {
        for (let i: number = 0; i < 10; i++) {
            await emailService.queue(makeQueueData({ priority: EmailPriority.HIGH, subject: `High ${i}` }));
        }

        await emailService.sendQueuedEmails();

        // HIGH is capped at 8; no NORMAL or LOW queued, so total = 8
        expect(mockSend).toHaveBeenCalledTimes(8);
    });

    it('fills remaining slots with NORMAL and LOW after HIGH', async () => {
        for (let i: number = 0; i < 8; i++) {
            await emailService.queue(makeQueueData({ priority: EmailPriority.HIGH, subject: `High ${i}` }));
        }
        for (let i: number = 0; i < 5; i++) {
            await emailService.queue(makeQueueData({ priority: EmailPriority.NORMAL, subject: `Normal ${i}` }));
        }
        for (let i: number = 0; i < 5; i++) {
            await emailService.queue(makeQueueData({ priority: EmailPriority.LOW, subject: `Low ${i}` }));
        }

        await emailService.sendQueuedEmails();

        // 8 high + 1 normal (10 - 1 - 8 = 1) + 1 low (10 - 8 - 1 = 1) = 10
        expect(mockSend).toHaveBeenCalledTimes(10);
    });
});

describe('EmailService attachment validation', () => {
    it('throws when an attachment path does not exist', async () => {
        await emailService.queue(makeQueueData({
            persist: true,
            attachments: [{ filename: 'missing.pdf', path: FsUtilities.getPath('/nonexistent/missing.pdf') }]
        }));
        mockSend.mockResolvedValue(accepted());

        await expect(emailService.sendQueuedEmails()).rejects.toThrow('does not exist');
    });

    it('does not throw when attachments is undefined', async () => {
        await emailService.queue(makeQueueData({ persist: true }));

        await expect(emailService.sendQueuedEmails()).resolves.not.toThrow();
    });

    it('does not throw when attachments is an empty array', async () => {
        await emailService.queue(makeQueueData({ persist: true, attachments: [] }));

        await expect(emailService.sendQueuedEmails()).resolves.not.toThrow();
    });

    it('does not throw when attachment path exists', async () => {
        // __filename is always a real path
        await emailService.queue(makeQueueData({
            persist: true,
            attachments: [{ filename: 'test.ts', path: FsUtilities.getPath(__filename) }]
        }));

        await expect(emailService.sendQueuedEmails()).resolves.not.toThrow();
    });
});