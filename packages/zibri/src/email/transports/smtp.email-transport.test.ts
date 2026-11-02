import { AddressInfo, createServer, Server } from 'node:net';

import { afterAll, beforeAll, beforeEach, describe, expect, it } from '@jest/globals';
import { createFakeKeyPair, FakeKeyPair } from 'zibri-testing';

import { EmailSendResult } from './email-transport.interface';
import { SmtpEmailTransport } from './smtp.email-transport';
import { CapturingSmtpServer } from '../../__testing__/capturing-smtp-server.model';
import { UUIDUtilities } from '../../utilities/uuid.utilities';
import { EmailPriority } from '../models/email-priority.enum';
import { EmailStatus } from '../models/email-status.enum';
import { Email } from '../models/email.model';

let smtp: CapturingSmtpServer;
let transport: SmtpEmailTransport;

beforeAll(async () => {
    smtp = await CapturingSmtpServer.start();
    // no pooled connection to outlive the server
    transport = new SmtpEmailTransport({ host: '127.0.0.1', port: smtp.port, pool: false, requireTls: false, auth: { user: '', pass: '' } });
});

afterAll(async () => {
    transport.close();
    await smtp.close();
});

beforeEach(() => {
    smtp.messages.length = 0;
});

/**
 * A queued mail, as the email service hands it to the transport.
 * @param data - What the mail holds beyond its defaults.
 * @returns The mail.
 */
function queuedEmail(data: Pick<Email, 'listUnsubscribeUrl' | 'attachments'>): Email {
    return {
        id: UUIDUtilities.generate(),
        createdAt: new Date(),
        persist: false,
        html: '<p>hello</p>',
        subject: 'Newsletter',
        sender: 'sender@example.com',
        recipients: ['recipient@example.com'],
        status: EmailStatus.QUEUED,
        priority: EmailPriority.LOW,
        attempts: 0,
        ...data
    };
}

/**
 * The headers of a message as it went over the wire, each on one line.
 * @param message - The message.
 * @returns Its headers, unfolded.
 */
function headersOf(message: string = ''): string[] {
    const [head = ''] = message.split('\r\n\r\n');
    return head.replaceAll(/\r\n[\t ]+/g, ' ').split('\r\n');
}

describe('SmtpEmailTransport', () => {
    // an unset port read as 0 and an unset host as '', and the transport was built with
    // both, so the application started and every mail failed when it was sent
    it.each([
        ['an empty host', { host: '', port: 587 }, /host/],
        ['port 0', { host: 'mail.example.com', port: 0 }, /port/],
        ['a port that is no number', { host: 'mail.example.com', port: Number.NaN }, /port/],
        ['a port past 65535', { host: 'mail.example.com', port: 70_000 }, /port/]
    ])('refuses %s when it is built', (_, server, message) => {
        expect(() => new SmtpEmailTransport({ ...server, auth: { user: '', pass: '' } })).toThrow(message);
    });

    it('writes the one-click unsubscribe headers of RFC 8058 for a mail sent to a list', async () => {
        await transport.send(queuedEmail({ listUnsubscribeUrl: 'https://example.com/unsubscribe?secret=abc' }));

        const headers: string[] = headersOf(smtp.messages[0]);
        expect(headers).toContain('List-Unsubscribe: <https://example.com/unsubscribe?secret=abc>');
        expect(headers).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    });

    // a send retried after the server took it gave the copy a new Message-ID, so nothing
    // downstream could tell it was the same mail
    it('names the message by the mail, the same on every attempt', async () => {
        const email: Email = queuedEmail({});

        await transport.send(email);
        await transport.send(email);

        const messageIds: (string | undefined)[] = smtp.messages.map(m => headersOf(m).find(h => h.toLowerCase().startsWith('message-id:')));
        expect(messageIds).toEqual([`Message-ID: <${email.id}@example.com>`, `Message-ID: <${email.id}@example.com>`]);
    });

    it('writes neither for a mail sent to no list', async () => {
        await transport.send(queuedEmail({}));

        const headers: string[] = headersOf(smtp.messages[0]);
        expect(headers.some(h => h.toLowerCase().startsWith('list-unsubscribe'))).toBe(false);
    });

    it('sends an attachment with the content it was queued with', async () => {
        const base64Content: string = Buffer.from('%PDF invoice 42').toString('base64');

        await transport.send(queuedEmail({ attachments: [{ filename: 'invoice.pdf', base64Content }] }));

        const message: string = smtp.messages[0] ?? '';
        expect(message).toContain('filename=invoice.pdf');
        expect(message).toContain(base64Content);
    });

    // a server routinely takes some recipients of one message and refuses others, and the service
    // records the mail as failed by the ones the transport reports
    it('reports the recipients the server refused, and sends to the others', async () => {
        smtp.refusedRecipients.add('nobody@example.com');
        try {
            const sent: EmailSendResult = await transport.send({ ...queuedEmail({}), recipients: ['recipient@example.com', 'nobody@example.com'] });

            expect(sent.rejectedRecipients).toEqual(['nobody@example.com']);
            expect(smtp.messages).toHaveLength(1);
        }
        finally {
            smtp.refusedRecipients.clear();
        }
    });

    it('refuses a server that offers no STARTTLS, unless told not to', async () => {
        const strict: SmtpEmailTransport = new SmtpEmailTransport({ host: '127.0.0.1', port: smtp.port, pool: false, auth: { user: '', pass: '' } });

        await expect(strict.send(queuedEmail({}))).rejects.toThrow(/STARTTLS/);
        expect(smtp.messages).toEqual([]);
    });

    it('sends over STARTTLS to a server whose certificate the authority it was given signed', async () => {
        const authority: FakeKeyPair = await createFakeKeyPair('CN=Mail Authority', { authority: true });
        const certificate: FakeKeyPair = await createFakeKeyPair('CN=mail.example.com', { issuer: authority, hosts: ['127.0.0.1'] });
        const tlsServer: CapturingSmtpServer = await CapturingSmtpServer.start({ key: certificate.privateKey, cert: certificate.certificate });
        const withAuthority: SmtpEmailTransport = new SmtpEmailTransport({
            host: '127.0.0.1',
            port: tlsServer.port,
            pool: false,
            auth: { user: '', pass: '' },
            tls: { ca: authority.certificate }
        });
        const withoutAuthority: SmtpEmailTransport = new SmtpEmailTransport({ host: '127.0.0.1', port: tlsServer.port, pool: false, auth: { user: '', pass: '' } });

        try {
            await expect(withoutAuthority.send(queuedEmail({}))).rejects.toThrow();
            await withAuthority.send(queuedEmail({}));

            expect(tlsServer.messages).toHaveLength(1);
        }
        finally {
            await tlsServer.close();
        }
    });

    it('gives up on a server that does not greet within the greeting timeout', async () => {
        const silent: Server = createServer(() => {});
        await new Promise<void>(resolve => silent.listen(0, '127.0.0.1', resolve));
        const address: AddressInfo | string | null = silent.address();
        const port: number = address != undefined && typeof address !== 'string' ? address.port : 0;
        const impatient: SmtpEmailTransport = new SmtpEmailTransport({
            host: '127.0.0.1',
            port,
            pool: false,
            requireTls: false,
            auth: { user: '', pass: '' },
            greetingTimeoutInMs: 200
        });

        try {
            const startedAt: number = Date.now();
            await expect(impatient.send(queuedEmail({}))).rejects.toThrow(/greeting/i);
            expect(Date.now() - startedAt).toBeLessThan(5000);
        }
        finally {
            await new Promise<void>(resolve => silent.close(() => resolve()));
        }
    }, 10_000);
});