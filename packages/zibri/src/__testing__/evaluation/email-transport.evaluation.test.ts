import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';

import { Repository } from '../../data-source/repository/repository';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { defineProvider } from '../../di/models/di-provider.model';
import { EmailServiceInterface } from '../../email/email-service.interface';
import { EmailConfigInput } from '../../email/models/email-config.model';
import { EmailStatus } from '../../email/models/email-status.enum';
import { Email } from '../../email/models/email.model';
import { EmailSendResult, EmailTransportInterface } from '../../email/transports/email-transport.interface';
import { defaultTestServerProviders } from '../test-server/providers';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md 5.2 - no swap-in path for real
 * infrastructure, the email row.
 *
 * The service built its nodemailer transporter in its own constructor, so the only way to send a
 * mail through anything else was to subclass `EmailService` and override a `protected` method. The
 * framework's own suites did exactly that, twice, which is the strongest evidence the finding is
 * right: if the project that wrote the class cannot swap the transport without reaching past its
 * public surface, neither can a deployment whose egress firewall forbids outbound SMTP.
 *
 * So this file never mentions SMTP. It sends through a transport that stands in for an http API -
 * SES, SendGrid, Postmark - and asks whether the rest of the mail subsystem still works over it:
 * the queue, the priorities, the per-mail claim, the rate limiter, and what becomes of the row.
 *
 * The shipped SMTP transport is held separately, by ./email-failure.evaluation.test.ts, which drives
 * real nodemailer against a real SMTP dialogue. Between the two, both sides of the seam are covered
 * by something that actually sends.
 *
 * Every expectation describes the fixed behavior, so this file is red until the finding is closed.
 * See ./README.md for why.
 */

/**
 * A transport that is not SMTP and does not use nodemailer.
 *
 * It stands in for the http API transports the finding names. Everything it does is decide what to
 * answer and write down what it was given - which is the whole point: if this can be plugged in,
 * so can one that actually posts to an endpoint.
 */
class RecordingEmailTransport implements EmailTransportInterface {

    readonly name: string = 'RecordingEmailTransport';

    /**
     * The mails handed over, in the order the service handed them over.
     */
    readonly sends: Email[] = [];

    /**
     * How many times close() was called. The service owns the transport's lifetime, so a pooled
     * connection or a keep-alive agent has to be told when the application is going away.
     */
    closedCount: number = 0;

    /**
     * Addresses this transport answers "refused" for, standing in for an address that bounced.
     */
    rejects: string[] = [];

    /**
     * When set, the next send throws it instead of answering - a transport that could not reach the
     * provider at all.
     */
    failWith: Error | undefined = undefined;

    async send(email: Email): Promise<EmailSendResult> {
        this.sends.push(email);
        // awaited so a send is at least one turn of the loop, the way a real one is
        await Promise.resolve();

        if (this.failWith) {
            throw this.failWith;
        }

        return { rejectedRecipients: email.recipients.filter((r: string) => this.rejects.includes(r)) };
    }

    close(): void {
        this.closedCount++;
    }

    /**
     * Forgets everything recorded, so one test cannot read another's sends.
     */
    reset(): void {
        this.sends.splice(0, this.sends.length);
        this.rejects = [];
        this.failWith = undefined;
    }
}

const transport: RecordingEmailTransport = new RecordingEmailTransport();

const ACCEPTED_RECIPIENT: string = 'real-user@example.com';
const REJECTED_RECIPIENT: string = 'no-such-user@example.com';

let server: StartedTestServer | undefined;
let emailRepository: Repository<Email>;
let emailService: EmailServiceInterface;

beforeAll(async () => {
    server = await startTestServer({
        providers: [
            ...defaultTestServerProviders,
            defineProvider({
                token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                // no host, no port, no auth, no pool. A mail configuration that names an SMTP server
                // is a mail configuration that assumes one, and the whole finding is that a
                // deployment sending over an http API has no such thing to name. That this type
                // accepts the object below is half of what is being asserted here
                useFactory: (): EmailConfigInput => ({
                    // the shared default is 0, which is a token bucket that refuses every send
                    maxEmailsPerHour: 100,
                    defaultSender: 'sender@example.com',
                    // short, so the retry test can wait out the claim a failed attempt retains and the
                    // backoff it sets, rather than the minute each defaults to
                    sendLeaseInMs: 1000,
                    retryDelayInMs: 1000,
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
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
}, 15000);

beforeEach(async () => {
    await emailRepository.deleteAll({});
    transport.reset();
});

describe('evaluation/04-infrastructure-subsystems 5.2 - the mail transport is replaceable', () => {

    it('sends a queued mail through the transport it was given', async () => {
        await emailService.queue({
            recipients: [ACCEPTED_RECIPIENT],
            subject: 'through a replaceable transport',
            html: '<p>hello</p>'
        });

        await emailService.sendQueuedEmails();

        expect(transport.sends).toHaveLength(1);
        // the message reaches the transport as something an http API can be handed: addresses, a
        // subject, a body. Not an Email row - a transport has no business knowing about `status`,
        // `persist` or the id the queue tracks it by
        expect(transport.sends[0]?.recipients).toEqual([ACCEPTED_RECIPIENT]);
        expect(transport.sends[0]?.subject).toBe('through a replaceable transport');
        expect(transport.sends[0]?.html).toBe('<p>hello</p>');
    });

    it('fills the sender in from the configuration before the transport sees it', async () => {
        await emailService.queue({ recipients: [ACCEPTED_RECIPIENT], subject: 'default sender', html: '<p>hello</p>' });

        await emailService.sendQueuedEmails();

        // defaultSender is service policy rather than a property of the connection, so it is applied
        // on the way into the queue and every transport gets an addressed message
        expect(transport.sends[0]?.sender).toBe('sender@example.com');
    });

    it('drains the queue when the transport accepted the mail', async () => {
        await emailService.queue({ recipients: [ACCEPTED_RECIPIENT], subject: 'accepted', html: '<p>hello</p>' });

        await emailService.sendQueuedEmails();

        // persist defaults to false, so a sent mail leaves no row. The control that says the
        // subsystem really ran end to end over this transport rather than merely being handed a
        // message
        expect(await emailRepository.findAll({})).toHaveLength(0);
    });

    it('records a refusal the transport reported, without knowing how it learned it', async () => {
        transport.rejects = [REJECTED_RECIPIENT];
        await emailService.queue({
            recipients: [ACCEPTED_RECIPIENT, REJECTED_RECIPIENT],
            subject: 'partially rejected',
            html: '<p>hello</p>'
        });

        await emailService.sendQueuedEmails();

        // `rejectedRecipients` used to be read off nodemailer's own SentMessageInfo, which is why
        // there was no way to express the same answer from an API that returns json. It is the
        // transport contract now, so a per-recipient verdict survives whatever produced it
        const stored: Email[] = await emailRepository.findAll({});

        expect(stored).toHaveLength(1);
        expect(stored[0]?.status).toBe(EmailStatus.FAILED);
        expect(stored[0]?.rejectedRecipients).toEqual([REJECTED_RECIPIENT]);
    });

    it('leaves a mail queued when the transport could not reach the provider', async () => {
        transport.failWith = new Error('connect ECONNREFUSED');
        await emailService.queue({ recipients: [ACCEPTED_RECIPIENT], subject: 'unreachable', html: '<p>hello</p>' });

        await emailService.sendQueuedEmails().catch(() => undefined);

        // the other half of the contract, and the half a transport author gets wrong if nothing
        // states it: throwing means "this never reached the provider, ask again", answering with
        // rejected recipients means "the provider replied and refused these". Only the second is a
        // verdict, so only the second may end the mail
        const stored: Email[] = await emailRepository.findAll({});

        expect(stored).toHaveLength(1);
        expect(stored[0]?.status).toBe(EmailStatus.QUEUED);
    });

    it('sends a mail again once the transport recovered', async () => {
        transport.failWith = new Error('connect ECONNREFUSED');
        await emailService.queue({ recipients: [ACCEPTED_RECIPIENT], subject: 'retried', html: '<p>hello</p>' });
        await emailService.sendQueuedEmails().catch(() => undefined);

        transport.failWith = undefined;
        // a failed attempt holds the row back until its retry is due, and the claim taken for it is
        // retained as well, so the row is not available again until both expire. Waiting them out is
        // what proves the row was kept as sendable rather than merely kept
        await new Promise<void>(resolve => setTimeout(resolve, 1500));
        await emailService.sendQueuedEmails();

        expect(transport.sends).toHaveLength(2);
        expect(await emailRepository.findAll({})).toHaveLength(0);
    }, 20000);

    // deliberately last, and it shuts the shared server down itself. A second application cannot be
    // started alongside the first - that is 02 C7, which closed by letting a process run them one
    // after another rather than at once - so the only way to observe a shutdown is to spend this
    // file's own.
    it('closes the transport when the application shuts down', async () => {
        // the service used to call transporter.close() on a nodemailer object it owned. A transport
        // holding an http agent, a pooled connection or an SDK client needs the same signal, and
        // only the thing that built it knows what closing means
        expect(transport.closedCount).toBe(0);

        await server?.shutdown();
        // so afterAll does not shut down an application that is already gone
        server = undefined;

        expect(transport.closedCount).toBe(1);
    }, 30000);
});