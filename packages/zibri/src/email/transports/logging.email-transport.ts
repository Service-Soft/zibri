import { EmailSendResult, EmailTransportInterface } from './email-transport.interface';
import { ZIBRI_DI_TOKENS } from '../../di/default/zibri-di-tokens.default';
import { inject } from '../../di/inject.function';
import { LoggerInterface } from '../../logging/logger.interface';
import { Email } from '../models/email.model';

/**
 * A transport that logs every mail instead of sending it: its recipients, its subject and its
 * content, links included. What an application that provides no transport gets in development, so
 * a project runs, and a password reset can be followed, before it has a mail server.
 *
 * The content it logs holds whatever the mail does, a password reset link among it, so it is no
 * transport for production.
 */
export class LoggingEmailTransport implements EmailTransportInterface {
    // eslint-disable-next-line jsdoc/require-jsdoc
    readonly name: string = 'LoggingEmailTransport';

    /**
     * Creates a transport that logs to the given logger.
     * @param logger - Where the mails are logged. The application's logger by default.
     */
    constructor(private readonly logger: LoggerInterface = inject(ZIBRI_DI_TOKENS.LOGGER)) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    send(email: Email): Promise<EmailSendResult> {
        this.logger.info([
            `Email "${email.subject}" to ${email.recipients.join(', ')}, logged instead of sent:`,
            email.html
        ].join('\n'));
        return Promise.resolve({ rejectedRecipients: [] });
    }
}
