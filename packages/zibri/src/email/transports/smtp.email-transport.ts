import { createTransport, Transporter } from 'nodemailer';
import SMTPPool from 'nodemailer/lib/smtp-pool';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

import { EmailSendResult, EmailTransportInterface } from './email-transport.interface';
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
     * Whether the connection is TLS from the first byte rather than upgraded with STARTTLS.
     *
     * Defaults to true on port 465 and false everywhere else, which is what those ports conventionally
     * mean. Say it explicitly when a server does implicit TLS on some other port - inferring it from
     * the port number is a good guess and a bad requirement.
     */
    secure?: boolean
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
     */
    constructor(options: SmtpEmailTransportOptions) {
        const transportOptions: SMTPTransport.Options = {
            host: options.host,
            port: options.port,
            auth: options.auth,
            secure: options.secure ?? options.port === 465
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
            attachments: email.attachments ?? undefined
        });

        // nodemailer rejects the connection-level failures by throwing, so reaching this line means
        // the server answered - and `rejected` is the per recipient half of that answer
        return {
            rejectedRecipients: res.rejected.map(r => typeof r === 'string' ? r : r.address)
        };
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    close(): void {
        this.transporter.close();
    }
}