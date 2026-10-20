import { AddressInfo, createServer, Server, Socket } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { Repository } from '../../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../../di/decorators/inject-repository.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default.ts';
import { inject } from '../../di/inject.function.ts';
import { defineProvider } from '../../di/models/di-provider.model.ts';
import { EmailServiceInterface } from '../../email/email-service.interface.ts';
import { EmailConfigInput } from '../../email/models/email-config.model.ts';
import { EmailStatus } from '../../email/models/email-status.enum.ts';
import { Email } from '../../email/models/email.model.ts';
import { SmtpEmailTransport } from '../../email/transports/smtp.email-transport.ts';
import { defaultTestServerProviders } from '../test-server/providers.ts';
import { StartedTestServer, startTestServer } from '../test-server/start-test-server.function.ts';

/**
 * Executable form of evaluation/04-infrastructure-subsystems.md 2.2 - failed emails are silently
 * deleted.
 *
 * Driven against a real SMTP dialogue rather than a stubbed transporter, because the finding is
 * about one specific answer from a mail server: a partial rejection. A transport that fails
 * outright is already handled - the send throws, the claim is left to expire and the row stays
 * QUEUED. The damaging case is the one where the server says yes to one recipient and no to
 * another, which is what a real MX does when an address no longer exists.
 *
 * Every expectation describes the fixed behavior, so the reds here are open findings.
 * See ./README.md for why.
 */

const REJECTED_RECIPIENT: string = 'no-such-user@example.com';
const ACCEPTED_RECIPIENT: string = 'real-user@example.com';

/**
 * The smallest SMTP server that can answer a partial rejection.
 *
 * It speaks no more of the protocol than nodemailer needs to get through one message: a greeting,
 * a single line EHLO answer that advertises nothing (so no STARTTLS and no AUTH are attempted),
 * and a per recipient verdict. Everything it does not recognize is answered 250, since none of it
 * changes what is being tested.
 * @returns The listening server, whose address carries the port to point the email config at.
 */
async function startRejectingSmtpServer(): Promise<Server> {
    const server: Server = createServer((socket: Socket) => {
        let readingMessageBody: boolean = false;
        socket.write('220 localhost ESMTP\r\n');

        socket.on('data', (chunk: Buffer) => {
            for (const line of chunk.toString('utf8').split('\r\n')) {
                if (readingMessageBody) {
                    if (line === '.') {
                        readingMessageBody = false;
                        socket.write('250 2.0.0 queued\r\n');
                    }
                    continue;
                }
                if (!line.length) {
                    continue;
                }

                const command: string = line.slice(0, 4).toUpperCase();
                switch (command) {
                    case 'EHLO':
                    case 'HELO': {
                        socket.write('250 localhost\r\n');
                        break;
                    }
                    case 'MAIL': {
                        socket.write('250 2.1.0 sender ok\r\n');
                        break;
                    }
                    case 'RCPT': {
                        socket.write(
                            line.includes(REJECTED_RECIPIENT)
                                ? '550 5.1.1 no such user here\r\n'
                                : '250 2.1.5 recipient ok\r\n'
                        );
                        break;
                    }
                    case 'DATA': {
                        readingMessageBody = true;
                        socket.write('354 go ahead\r\n');
                        break;
                    }
                    case 'QUIT': {
                        socket.write('221 bye\r\n');
                        socket.end();
                        break;
                    }
                    default: {
                        socket.write('250 2.0.0 ok\r\n');
                    }
                }
            }
        });
        // a socket the mail server drops mid conversation must not take the test process with it
        socket.on('error', () => {});
    });

    await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
    return server;
}

let smtpServer: Server | undefined;
let server: StartedTestServer | undefined;
let emailRepository: Repository<Email>;
let emailService: EmailServiceInterface;

beforeAll(async () => {
    smtpServer = await startRejectingSmtpServer();
    const { port }: AddressInfo = smtpServer.address() as AddressInfo;

    server = await startTestServer({
        providers: [
            ...defaultTestServerProviders,
            defineProvider({
                token: ZIBRI_DI_TOKENS.EMAIL_CONFIG,
                useFactory: (): EmailConfigInput => ({
                    // the shared default is 0, which is a token bucket that refuses every send
                    maxEmailsPerHour: 100,
                    defaultSender: 'sender@example.com',
                    failedRetentionInMs: 'forever'
                })
            }),
            defineProvider({
                token: ZIBRI_DI_TOKENS.EMAIL_TRANSPORT,
                // the transport Zibri ships, driving real nodemailer against the server above. This
                // file is what keeps the smtp side of the seam honest: 5.2 moved the send behind
                // EmailTransportInterface, and the sibling email-transport file proves something
                // that is *not* smtp can be plugged in - between them both sides actually send
                useValue: new SmtpEmailTransport({
                    host: '127.0.0.1',
                    port: port,
                    // no pooled connection to outlive the server below
                    pool: false,
                    auth: { user: '', pass: '' }
                })
            })
        ]
    });
    emailRepository = inject(repositoryTokenFor(Email));
    emailService = inject(ZIBRI_DI_TOKENS.EMAIL_SERVICE);
}, 30000);

afterAll(async () => {
    // guarded so a failed beforeAll reports the real cause instead of a shutdown TypeError
    await server?.shutdown();
    smtpServer?.close();
}, 15000);

beforeEach(async () => {
    await emailRepository.deleteAll({});
});

describe('evaluation/04-infrastructure-subsystems 2.2 - a rejected email must leave a trail', () => {

    it('removes a mail from the queue once every recipient accepted it', async () => {
        // a control: it establishes that the queue really drains through the stub server, so a red
        // below is about the rejection rather than about nothing having been sent at all
        await emailService.queue({ recipients: [ACCEPTED_RECIPIENT], subject: 'accepted', html: '<p>hello</p>' });

        await emailService.sendQueuedEmails();

        expect(await emailRepository.findAll({})).toHaveLength(0);
    });

    it('records the failure when a recipient was rejected and the mail is not persisted', async () => {
        await emailService.queue({
            recipients: [ACCEPTED_RECIPIENT, REJECTED_RECIPIENT],
            subject: 'partially rejected',
            html: '<p>hello</p>'
        });

        await emailService.sendQueuedEmails();

        // the row used to be DELETEd on the default persist: false, leaving a rejected password
        // reset or 2fa mail with one warn line behind it and nothing to answer "did it go out" with.
        // `persist` decides what happens to a mail that was *sent*; one that failed is kept either
        // way
        const stored: Email[] = await emailRepository.findAll({});

        expect(stored).toHaveLength(1);
        expect(stored[0]?.status).toBe(EmailStatus.FAILED);
        // and the row has to say which address bounced, or it is a tombstone rather than a trail:
        // a server routinely accepts some recipients of one message and refuses others
        expect(stored[0]?.rejectedRecipients).toEqual([REJECTED_RECIPIENT]);
    });

    it('leaves a queued mail that was fully accepted out of the way', async () => {
        // the control that keeps the change above honest: keeping failures must not turn the queue
        // into a table that only grows. A mail that was sent still obeys persist
        await emailService.queue({
            recipients: [ACCEPTED_RECIPIENT],
            subject: 'accepted and not persisted',
            html: '<p>hello</p>'
        });

        await emailService.sendQueuedEmails();

        expect(await emailRepository.findAll({})).toHaveLength(0);
    });

    it('does not send a failed mail again', async () => {
        await emailService.queue({
            recipients: [ACCEPTED_RECIPIENT, REJECTED_RECIPIENT],
            subject: 'failed once',
            html: '<p>hello</p>'
        });

        await emailService.sendQueuedEmails();
        await emailService.sendQueuedEmails();

        // the row is a record, not a retry: only QUEUED mails are picked up, so the kept row does
        // not become a mail that is attempted forever
        const stored: Email[] = await emailRepository.findAll({});

        expect(stored).toHaveLength(1);
        expect(stored[0]?.status).toBe(EmailStatus.FAILED);
    });

    it('records the failure when a recipient was rejected and the mail is persisted', async () => {
        // a control for the red above: with persist: true the same send writes FAILED and keeps the
        // row, which proves the rejection is detected. The deletion is the only difference between
        // the two, so the finding is about the default rather than about detecting a bounce.
        await emailService.queue({
            recipients: [ACCEPTED_RECIPIENT, REJECTED_RECIPIENT],
            subject: 'partially rejected but persisted',
            html: '<p>hello</p>',
            persist: true
        });

        await emailService.sendQueuedEmails();

        const stored: Email[] = await emailRepository.findAll({});

        expect(stored).toHaveLength(1);
        expect(stored[0]?.status).toBe(EmailStatus.FAILED);
    });
});