
import { createTransport, Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

import { Repository } from '../data-source';
import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../di';
import { EmailServiceInterface } from './email-service.interface';
import { CreateEmailData, Email, EmailAttachment, EmailConfig, EmailConfigInput, EmailPriority, EmailStatus, QueueEmailData } from './models';
import { ZibriApplication } from '../application';
import { SendQueuedEmailsCronJob } from './send-queued-emails.cron-job';
import { LoggerInterface } from '../logging';
import { RateLimiter } from '../rate-limiting';
import { FsUtilities } from '../utilities';

/**
 * Default email service implementation of Zibri.
 */
export class EmailService implements EmailServiceInterface {
    /**
     * The internal nodemailer transporter.
     */
    protected readonly transporter: Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options>;
    /**
     * The repository that handles storing and receiving emails from the db.
     */
    protected readonly emailRepository: Repository<Email, CreateEmailData>;
    /**
     * The email configuration.
     */
    protected readonly config: EmailConfig;
    /**
     * A rate limiter to prevent overloading the email provider.
     */
    protected readonly rateLimiter: RateLimiter;
    /**
     * A logger.
     */
    protected readonly logger: LoggerInterface;

    constructor() {
        this.emailRepository = inject(repositoryTokenFor(Email));
        const config: EmailConfigInput | undefined = inject(ZIBRI_DI_TOKENS.EMAIL_CONFIG);
        if (!config) {
            throw new Error('no email config was provided for the token "ZIBRI_DI_TOKENS.MAIL_CONFIG"');
        }
        this.config = {
            pool: true,
            ...config
        };
        this.rateLimiter = RateLimiter.perHour(this.config.maxEmailsPerHour);
        this.transporter = createTransport({ ...this.config, secure: config?.port === 465 });
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    attachTo(app: ZibriApplication): void {
        app.options.cronJobs.push(SendQueuedEmailsCronJob);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async queue(data: QueueEmailData): Promise<void> {
        await this.emailRepository.create({
            status: EmailStatus.QUEUED,
            priority: EmailPriority.NORMAL,
            persist: false,
            sender: this.config.defaultSender,
            ...data
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async sendQueuedEmails(): Promise<boolean> {
        const highMails: Email[] = await this.findMails(EmailPriority.HIGH, 8);
        const normalMails: Email[] = await this.findMails(EmailPriority.NORMAL, 10 - 1 - highMails.length);
        const lowMails: Email[] = await this.findMails(EmailPriority.LOW, 10 - highMails.length - normalMails.length);
        const emails: Email[] = [...highMails, ...normalMails, ...lowMails];

        if (!emails.length || !this.rateLimiter.isAvailable(emails.length)) {
            return false;
        }

        await Promise.all(emails.map(m => this.send(m)));
        return true;
    }

    /**
     * Sends out the given email.
     * @param email - The email to send out.
     */
    protected async send(email: Email): Promise<void> {
        await this.validateAttachments(email.attachments);
        const res: SMTPTransport.SentMessageInfo = await this.transporter.sendMail({
            html: email.html,
            subject: email.subject,
            from: email.sender,
            to: email.recipients,
            bcc: email.bcc,
            cc: email.cc,
            attachments: email.attachments
        });

        const status: EmailStatus = res.rejected.length ? EmailStatus.FAILED : EmailStatus.SENT;

        if (status === EmailStatus.FAILED) {
            const rejectedRecipients: string[] = res.rejected.map((e) => typeof e === 'string' ? e : e.address);
            await this.logger.warn(`mail to ${rejectedRecipients.join(', ')} was rejected`);
        }

        if (email.persist) {
            await this.emailRepository.updateById(email.id, { status });
            return;
        }

        await this.emailRepository.deleteById(email.id);
    }

    /**
     * Resolves the given attachments.
     * @param attachments - The attachments to resolve.
     * @returns The resolved attachments.
     */
    protected async validateAttachments(attachments: EmailAttachment[] | undefined): Promise<void> {
        if (!attachments?.length) {
            return;
        }

        await Promise.all(
            attachments.map(async a => {
                if (!await FsUtilities.exists(a.path)) {
                    throw new Error(`mail attachment at path ${a.path} does not exist`);
                }
            })
        );
    }

    /**
     * Finds the emails with the given priority.
     * @param priority - The priority of the emails that should be found.
     * @param amount - The amount of emails to find.
     * @returns The found emails, sorted by the creation date.
     */
    protected async findMails(priority: EmailPriority, amount: number): Promise<Email[]> {
        return await this.emailRepository.findAll({
            where: {
                status: EmailStatus.QUEUED,
                priority
            },
            take: amount,
            order: { createdAt: 'ASC' }
        });
    }
}