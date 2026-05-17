import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from '@jest/globals';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

import { EmailService } from './email.service';
import { CreateEmailData, QueueEmailData } from './models/create-email-data.model';
import { EmailPriority } from './models/email-priority.enum';
import { EmailStatus } from './models/email-status.enum';
import { Email } from './models/email.model';
import { defaultTestServerProviders } from '../__testing__/test-server/providers';
import { startTestServer, StartedTestServer } from '../__testing__/test-server/start-test-server.function';
import { Repository } from '../data-source/repository';
import { EmailConfig } from './models/email-config.model';
import { InjectRepository, repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { type LoggerInterface } from '../logging/logger.interface';

// ---------- Test email service (mocks the transporter) ----------

// eslint-disable-next-line typescript/typedef
const mockSendMail = jest.fn<() => Promise<SMTPTransport.SentMessageInfo>>();

const testConfig: EmailConfig = {
    host: 'smtp.example.com',
    port: 587,
    maxEmailsPerHour: 1000,
    defaultSender: 'noreply@example.com',
    pool: false,
    auth: { user: 'user', pass: 'pass' }
};

@Injectable({ register: 'onUse' })
class TestEmailService extends EmailService {
    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER) logger: LoggerInterface,
        @InjectRepository(Email) emailRepository: Repository<Email, CreateEmailData>
    ) {
        super(logger, emailRepository, testConfig);
    }

    protected override async send(email: Email): Promise<void> {
        await this.validateAttachments(email.attachments);
        const res: SMTPTransport.SentMessageInfo = await mockSendMail();
        const status: EmailStatus = res.rejected.length ? EmailStatus.FAILED : EmailStatus.SENT;

        if (status === EmailStatus.FAILED) {
            const rejectedRecipients: string[] = res.rejected.map((e) => typeof e === 'string' ? e : e.address);
            await this['logger'].warn(`mail to ${rejectedRecipients.join(', ')} was rejected`);
        }

        if (email.persist) {
            await this['emailRepository'].updateById(email.id, { status });
            return;
        }

        await this['emailRepository'].deleteById(email.id);
    }
}

// ---------- Helpers ----------

function sentMessageInfo(overrides: Partial<SMTPTransport.SentMessageInfo> = {}): SMTPTransport.SentMessageInfo {
    return {
        accepted: ['recipient@example.com'],
        rejected: [],
        pending: [],
        response: '250 OK',
        envelope: { from: 'noreply@example.com', to: ['recipient@example.com'] },
        messageId: 'test-message-id',
        ...overrides
    } as SMTPTransport.SentMessageInfo;
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
let emailService: TestEmailService;
let emailRepo: Repository<Email, CreateEmailData>;

beforeAll(async () => {
    server = await startTestServer({
        providers: [
            ...defaultTestServerProviders,
            { token: ZIBRI_DI_TOKENS.EMAIL_CONFIG, useValue: testConfig },
            { token: ZIBRI_DI_TOKENS.EMAIL_SERVICE, useClass: TestEmailService }
        ]
    });
    await server.start();

    emailService = inject(TestEmailService);
    emailRepo = inject(repositoryTokenFor(Email));
}, 15000);

afterAll(async () => {
    await server.shutdown();
});

beforeEach(async () => {
    await emailRepo.deleteAll({});
    mockSendMail.mockReset();
    mockSendMail.mockResolvedValue(sentMessageInfo());
});

// ---------- Tests ----------

describe('EmailService.queue', () => {
    it('creates an email with QUEUED status', async () => {
        await emailService.queue(makeQueueData());

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails).toHaveLength(1);
        expect(emails[0].status).toBe(EmailStatus.QUEUED);
    });

    it('defaults to NORMAL priority', async () => {
        await emailService.queue(makeQueueData());

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0].priority).toBe(EmailPriority.NORMAL);
    });

    it('respects provided priority', async () => {
        await emailService.queue(makeQueueData({ priority: EmailPriority.HIGH }));

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0].priority).toBe(EmailPriority.HIGH);
    });

    it('defaults to defaultSender from config when no sender provided', async () => {
        await emailService.queue(makeQueueData());

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0].sender).toBe(testConfig.defaultSender);
    });

    it('respects provided sender', async () => {
        await emailService.queue(makeQueueData({ sender: 'custom@example.com' }));

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0].sender).toBe('custom@example.com');
    });

    it('defaults persist to false', async () => {
        await emailService.queue(makeQueueData());

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0].persist).toBe(false);
    });

    it('respects provided persist flag', async () => {
        await emailService.queue(makeQueueData({ persist: true }));

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0].persist).toBe(true);
    });
});

describe('EmailService.sendQueuedEmails', () => {
    afterEach(() => void jest.restoreAllMocks());

    it('returns false and sends nothing when no emails are queued', async () => {
        const result: boolean = await emailService.sendQueuedEmails();

        expect(result).toBe(false);
        expect(mockSendMail).not.toHaveBeenCalled();
    });

    it('returns true after sending emails (indicating there may be more)', async () => {
        await emailService.queue(makeQueueData());

        const result: boolean = await emailService.sendQueuedEmails();

        expect(result).toBe(true);
        expect(mockSendMail).toHaveBeenCalledTimes(1);
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
        expect(emails[0].status).toBe(EmailStatus.SENT);
    });

    it('updates email status to FAILED when the send is rejected', async () => {
        mockSendMail.mockResolvedValue(sentMessageInfo({
            rejected: ['recipient@example.com'],
            accepted: []
        }));
        await emailService.queue(makeQueueData({ persist: true }));

        await emailService.sendQueuedEmails();

        const emails: Email[] = await emailRepo.findAll({});
        expect(emails[0].status).toBe(EmailStatus.FAILED);
    });

    it('sends HIGH priority emails before NORMAL and LOW', async () => {
        // eslint-disable-next-line typescript/require-await
        mockSendMail.mockImplementation(async () => {
            return sentMessageInfo();
        });

        // Queue in reverse priority order to ensure ordering is by priority, not insertion
        await emailService.queue(makeQueueData({ priority: EmailPriority.LOW, subject: 'low' }));
        await emailService.queue(makeQueueData({ priority: EmailPriority.NORMAL, subject: 'normal' }));
        await emailService.queue(makeQueueData({ priority: EmailPriority.HIGH, subject: 'high' }));

        // Capture send order by intercepting the underlying send call
        const calls: Email[] = [];
        jest.spyOn(emailService as unknown as { send: (e: Email) => Promise<void> }, 'send')
            // eslint-disable-next-line typescript/require-await
            .mockImplementation(async (email: Email) => {
                calls.push(email);
            });

        await emailService.sendQueuedEmails();

        expect(calls[0].priority).toBe(EmailPriority.HIGH);
        expect(calls[1].priority).toBe(EmailPriority.NORMAL);
        expect(calls[2].priority).toBe(EmailPriority.LOW);
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
        expect(mockSendMail).toHaveBeenCalledTimes(10);
    });

    it('sends at most 8 HIGH priority emails per batch', async () => {
        for (let i: number = 0; i < 10; i++) {
            await emailService.queue(makeQueueData({ priority: EmailPriority.HIGH, subject: `High ${i}` }));
        }

        await emailService.sendQueuedEmails();

        // HIGH is capped at 8; no NORMAL or LOW queued, so total = 8
        expect(mockSendMail).toHaveBeenCalledTimes(8);
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
        expect(mockSendMail).toHaveBeenCalledTimes(10);
    });
});

// describe('EmailService rate limiting', () => {
//     // A separate server with a very low rate limit so we can exhaust it with real sends
//     const rateLimitConfig: EmailConfig = { ...testConfig, maxEmailsPerHour: 3 };

//     let rateLimitServer: StartedTestServer;
//     let rateLimitEmailService: TestEmailService;
//     let rateLimitEmailRepo: Repository<Email, CreateEmailData>;

//     beforeAll(async () => {
//         rateLimitServer = await startTestServer({
//             dataSources: [
//                 createTestDataSource({
//                     entities: [...defaultTestServerEntities, Email]
//                 })
//             ],
//             controllers: [],
//             cronJobs: [],
//             providers: [
//                 ...defaultTestServerProviders,
//                 { token: ZIBRI_DI_TOKENS.EMAIL_CONFIG, useValue: rateLimitConfig },
//                 { token: ZIBRI_DI_TOKENS.EMAIL_SERVICE, useClass: TestEmailService }
//             ]
//         });
//         await rateLimitServer.start();
//         rateLimitEmailService = inject(TestEmailService);
//         rateLimitEmailRepo = inject(repositoryTokenFor(Email));
//     }, 15000);

//     afterAll(async () => {
//         await rateLimitServer.shutdown();
//     });

//     beforeEach(async () => {
//         await rateLimitEmailRepo.deleteAll({});
//         mockSendMail.mockReset();
//         mockSendMail.mockResolvedValue(sentMessageInfo());
//     });

//     it('returns false and sends nothing when the rate limit is exhausted', async () => {
//         // Exhaust the limit: queue and send 3 emails (maxEmailsPerHour: 3)
//         for (let i = 0; i < 3; i++) {
//             await rateLimitEmailService.queue(makeQueueData({ subject: `Email ${i}` }));
//         }
//         await rateLimitEmailService.sendQueuedEmails();
//         expect(mockSendMail).toHaveBeenCalledTimes(3);

//         // Queue one more — rate limiter should now block it
//         await rateLimitEmailService.queue(makeQueueData({ subject: 'One too many' }));
//         mockSendMail.mockReset();

//         const result = await rateLimitEmailService.sendQueuedEmails();

//         expect(result).toBe(false);
//         expect(mockSendMail).not.toHaveBeenCalled();
//     });
// });

describe('EmailService attachment validation', () => {
    it('throws when an attachment path does not exist', async () => {
        await emailService.queue(makeQueueData({
            persist: true,
            attachments: [{ filename: 'missing.pdf', path: '/nonexistent/missing.pdf' as never }]
        }));
        mockSendMail.mockResolvedValue(sentMessageInfo());

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
            attachments: [{ filename: 'test.ts', path: __filename as never }]
        }));

        await expect(emailService.sendQueuedEmails()).resolves.not.toThrow();
    });
});