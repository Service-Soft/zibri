import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createInMemoryDataSource } from 'zibri-testing';

import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { EmailServiceInterface } from '../../email/email-service.interface.ts';
import { EmailConfigInput } from '../../email/models/email-config.model.ts';
import { EmailPriority } from '../../email/models/email-priority.enum.ts';
import { EmailStatus } from '../../email/models/email-status.enum.ts';
import { Email } from '../../email/models/email.model.ts';
import { EmailSendResult, EmailTransportInterface } from '../../email/transports/email-transport.interface.ts';
import { defaultTestServerEntities } from '../test-server/create-test-data-source.function.ts';
import { defaultTestServerProviders } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md section 3.5, the half that was withdrawn.
 *
 * The finding counts three reads per ten mails and one write per mail, and asks for fewer. What these
 * show is what each of those is for: the three reads are what keeps a flood of one priority from taking
 * every pass, which one ordered read cannot, and the write per mail is what a crash costs one mail
 * rather than a whole pass.
 */

const SLOW_RECIPIENT: string = 'slow@example.com';

/**
 * A transport that writes down what it was handed, and holds one recipient's send until told to go on.
 */
class RecordingEmailTransport implements EmailTransportInterface {
    readonly name: string = 'RecordingEmailTransport';

    /**
     * The mails handed over, in the order they were handed over.
     */
    readonly sends: Email[] = [];

    private slowReleased: Promise<void> = Promise.resolve();
    private releaseSlow: () => void = () => undefined;

    async send(email: Email): Promise<EmailSendResult> {
        this.sends.push(email);
        if (email.recipients.includes(SLOW_RECIPIENT)) {
            await this.slowReleased;
        }
        return { rejectedRecipients: [] };
    }

    /**
     * Makes the next send to the slow recipient wait until {@link RecordingEmailTransport.release} is called.
     */
    holdSlow(): void {
        this.slowReleased = new Promise(resolve => {
            this.releaseSlow = resolve;
        });
    }

    /**
     * Lets a held send finish.
     */
    release(): void {
        this.releaseSlow();
    }

    /**
     * Forgets everything recorded, so one test cannot read another's sends.
     */
    reset(): void {
        this.sends.splice(0, this.sends.length);
        this.slowReleased = Promise.resolve();
    }
}

const transport: RecordingEmailTransport = new RecordingEmailTransport();

let server: StartedTestServer | undefined;
let emailRepository: Repository<Email>;
let emailService: EmailServiceInterface;

/**
 * Queues a mail.
 * @param priority - Its priority.
 * @param recipient - Who it goes to.
 * @param persist - Whether its row is kept once it was sent.
 */
async function queueMail(priority: EmailPriority, recipient: string = 'someone@example.com', persist: boolean = false): Promise<void> {
    await emailService.queue({ subject: priority, html: '<p></p>', recipients: [recipient], priority, persist });
}

beforeAll(async () => {
    server = await startTestServer({
        // in process: what is asserted is which mails a pass takes and when their rows are written, which
        // does not depend on the engine the rows are in
        dataSources: [createInMemoryDataSource({ entities: defaultTestServerEntities })],
        providers: [
            ...defaultTestServerProviders,
            defineProvider({
                token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                useFactory: (): EmailConfigInput => ({
                    maxEmailsPerHour: 1000,
                    defaultSender: 'sender@example.com',
                    failedRetentionInMs: 'forever'
                })
            }),
            defineProvider({ token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT, useValue: transport })
        ]
    });
    emailRepository = inject(repositoryTokenFor(Email));
    emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
}, 30000);

afterAll(async () => {
    await server?.shutdown();
}, 15000);

beforeEach(async () => {
    await emailRepository.deleteAll({});
    transport.reset();
});

describe('evaluation/04-infrastructure-subsystems', () => {

    describe('3.5 - the mail queue reads per priority and writes per mail', () => {

        it('sends NORMAL and LOW in the first pass although HIGH alone would fill it', async () => {
            for (let i: number = 0; i < 30; i++) {
                await queueMail(EmailPriority.HIGH);
            }
            await queueMail(EmailPriority.NORMAL);
            await queueMail(EmailPriority.LOW);

            await emailService.sendQueuedEmails();

            // one read ordered by priority and limited to the batch would have handed this pass ten HIGH
            // mails, and the next, and every pass for as long as HIGH keeps arriving. A read per priority
            // is what holds a slot back for each one below it
            const priorities: EmailPriority[] = transport.sends.map(e => e.priority);
            expect(priorities).toContain(EmailPriority.NORMAL);
            expect(priorities).toContain(EmailPriority.LOW);
            expect(priorities.filter(p => p === EmailPriority.HIGH)).toHaveLength(8);
        });

        it('writes a mail\'s row as soon as its own send returns, while another of the pass is still sending', async () => {
            transport.holdSlow();
            await queueMail(EmailPriority.NORMAL, 'fast@example.com', true);
            await queueMail(EmailPriority.NORMAL, SLOW_RECIPIENT, true);

            const pass: Promise<boolean> = emailService.sendQueuedEmails();
            let fast: Email | undefined;
            for (let attempt: number = 0; attempt < 100 && fast?.status !== EmailStatus.SENT; attempt++) {
                await new Promise(resolve => setTimeout(resolve, 10));
                [fast] = await emailRepository.findAll({ where: { recipients: { includes: ['fast@example.com'] } } });
            }

            // written per mail rather than once for the pass: a process that dies here has recorded the
            // mail that went out, so only the one still being sent can go out twice. Written together,
            // every mail of the pass would be sent again
            expect(fast?.status).toBe(EmailStatus.SENT);
            const [slow]: Email[] = await emailRepository.findAll({ where: { recipients: { includes: [SLOW_RECIPIENT] } } });
            expect(slow?.status).toBe(EmailStatus.QUEUED);

            transport.release();
            await pass;
        });
    });
});