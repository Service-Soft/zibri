import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { SmtpEmailTransport } from './smtp.email-transport.ts';
import { CapturingSmtpServer } from '../../__testing__/capturing-smtp-server.model.ts';
import { UUIDUtilities } from '../../utilities/uuid.utilities.ts';
import { EmailPriority } from '../models/email-priority.enum.ts';
import { EmailStatus } from '../models/email-status.enum.ts';
import { Email } from '../models/email.model.ts';

let smtp: CapturingSmtpServer;
let transport: SmtpEmailTransport;

beforeAll(async () => {
    smtp = await CapturingSmtpServer.start();
    // no pooled connection to outlive the server
    transport = new SmtpEmailTransport({ host: '127.0.0.1', port: smtp.port, pool: false, auth: { user: '', pass: '' } });
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
 * @param listUnsubscribeUrl - Where the recipient leaves the list the mail was sent to, if it was.
 * @returns The mail.
 */
function queuedEmail(listUnsubscribeUrl: string | undefined): Email {
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
        listUnsubscribeUrl
    };
}

/**
 * The headers of a message as it went over the wire, each on one line.
 * @param message - The message.
 * @returns Its headers, unfolded.
 */
function headersOf(message: string | undefined): string[] {
    const [head] = (message ?? '').split('\r\n\r\n');
    return (head ?? '').replaceAll(/\r\n[\t ]+/g, ' ').split('\r\n');
}

describe('SmtpEmailTransport', () => {
    it('writes the one-click unsubscribe headers of RFC 8058 for a mail sent to a list', async () => {
        await transport.send(queuedEmail('https://example.com/unsubscribe?secret=abc'));

        const headers: string[] = headersOf(smtp.messages[0]);
        expect(headers).toContain('List-Unsubscribe: <https://example.com/unsubscribe?secret=abc>');
        expect(headers).toContain('List-Unsubscribe-Post: List-Unsubscribe=One-Click');
    });

    it('writes neither for a mail sent to no list', async () => {
        await transport.send(queuedEmail(undefined));

        const headers: string[] = headersOf(smtp.messages[0]);
        expect(headers.some(h => h.toLowerCase().startsWith('list-unsubscribe'))).toBe(false);
    });
});