import type { ConnectionOptions } from 'node:tls';

import type { Transporter } from 'nodemailer';
import type SMTPPool from 'nodemailer/lib/smtp-pool';
import type SMTPTransport from 'nodemailer/lib/smtp-transport';

import { EmailSendResult, EmailTransportInterface } from './email-transport.interface';
import { InternalError } from '../../error-handling/internal-error.model';
import { optionalPeer } from '../../utilities/optional-peer.function';
import { Email } from '../models/email.model';

/**
 * How to reach an SMTP server.
 */
export type SmtpEmailTransportOptions = {
    /**
     * The host of the email server.
     */
    host: string,
    /**
     * The port of the email server.
     * Eg. 465.
     */
    port: number,
    /**
     * Auth data for the email server.
     */
    auth: {
        /**
         * The username of the account which should send the emails.
         */
        user: string,
        /**
         * The password of the account which should send the emails.
         */
        pass: string
    },
    /**
     * Whether or not to use a pool of connections instead of reconnecting to the mail server every time a new email should be sent.
     * Defaults to true.
     */
    pool?: boolean,
    /**
     * Whether the connection is TLS from the first byte. Otherwise it is upgraded with STARTTLS.
     *
     * Defaults to true on port 465 and false everywhere else, which is what those ports conventionally
     * mean. Say it explicitly when a server does implicit TLS on some other port.
     */
    secure?: boolean,
    /**
     * Whether a connection that is not `secure` refuses a server that offers no STARTTLS, so nothing,
     * the password included, is sent unencrypted.
     *
     * Defaults to true. Set it to false for a relay that speaks no TLS at all, such as one on the same
     * machine.
     */
    requireTls?: boolean,
    /**
     * Further TLS options, such as `ca` for a server whose certificate a private authority signed.
     */
    tls?: ConnectionOptions,
    /**
     * How long connecting to the server may take. Defaults to two minutes.
     */
    connectionTimeoutInMs?: number,
    /**
     * How long the server may take to greet once connected. Defaults to 30 seconds.
     */
    greetingTimeoutInMs?: number,
    /**
     * How long the connection may stay silent. Defaults to ten minutes.
     */
    socketTimeoutInMs?: number
};

/**
 * Delivers mail over SMTP, through nodemailer.
 *
 * The transport Zibri ships. A deployment whose egress forbids outbound SMTP - which is most of the
 * ones that have an egress policy at all - registers something else under
 * `ZIBRI_DI_TOKENS.EMAIL_TRANSPORT` instead.
 */
export class SmtpEmailTransport implements EmailTransportInterface {

    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'SmtpEmailTransport';

    // a union rather than one type, because nodemailer builds a different transport for a pooled
    // connection than for a fresh one per message, and says so in its own types. Only `rejected` and
    // `close` are read here, which both kinds have
    private readonly transporter: Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options>
        | Transporter<SMTPPool.SentMessageInfo, SMTPPool.Options>;

    /**
     * Creates a transport that sends through the given SMTP server.
     * @param options - How to reach the server.
     * @throws {InternalError} When the host is empty or the port is no port, so an application
     * missing its mail server does not start.
     */
    constructor(options: SmtpEmailTransportOptions) {
        if (options.host.trim() === '') {
            throw new InternalError('The SMTP host of the SmtpEmailTransport is empty.');
        }
        if (!Number.isInteger(options.port) || options.port < 1 || options.port > 65_535) {
            throw new InternalError(
                `The SMTP port of the SmtpEmailTransport has to be a whole number from 1 to 65535, got ${options.port}.`
            );
        }
        // eslint-disable-next-line typescript/typedef
        const createTransport = optionalPeer<typeof import('nodemailer')>('nodemailer', 'The smtp email transport').createTransport;

        // the timeouts left undefined fall back to nodemailer's, which the options name
        const transportOptions: SMTPTransport.Options = {
            host: options.host,
            port: options.port,
            auth: options.auth,
            secure: options.secure ?? options.port === 465,
            requireTLS: options.requireTls ?? true,
            tls: options.tls,
            connectionTimeout: options.connectionTimeoutInMs,
            greetingTimeout: options.greetingTimeoutInMs,
            socketTimeout: options.socketTimeoutInMs
        };
        this.transporter = options.pool ?? true
            ? createTransport({ ...transportOptions, pool: true })
            : createTransport(transportOptions);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async send(email: Email): Promise<EmailSendResult> {
        const res: SMTPTransport.SentMessageInfo | SMTPPool.SentMessageInfo = await this.transporter.sendMail({
            html: email.html,
            subject: email.subject,
            from: email.sender,
            to: email.recipients,
            bcc: email.bcc ?? undefined,
            cc: email.cc ?? undefined,
            attachments: email.attachments?.map(a => ({ filename: a.filename, content: a.base64Content, encoding: 'base64' })),
            // named by the mail rather than generated per send, so a send retried after the server
            // took the first one carries the same id, which receiving servers drop duplicates by
            messageId: `<${email.id}@${email.sender.slice(email.sender.lastIndexOf('@') + 1)}>`,
            // nodemailer writes the url as `List-Unsubscribe: <url>`; the second header is what makes
            // it a one-click unsubscribe (RFC 8058) rather than a link the provider opens in a browser
            ...email.listUnsubscribeUrl == undefined
                ? {}
                : {
                    list: { unsubscribe: email.listUnsubscribeUrl },
                    headers: { 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' }
                }
        });

        // nodemailer rejects the connection-level failures by throwing, so reaching this line means
        // the server answered - and `rejected` is the per recipient half of that answer: the bare
        // addresses of the envelope the server refused in reply to RCPT TO
        return {
            rejectedRecipients: res.rejected
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    close(): void {
        this.transporter.close();
    }
}