import { createTransport, Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

import { EmailServiceInterface } from './email-service.interface';
import { ZibriApplication } from '../application';
import { CreateEmailData, QueueEmailData } from './models/create-email-data.model';
import { Email } from './models/email.model';
import { SendQueuedEmailsCronJob } from './send-queued-emails.cron-job';
import { Repository } from '../data-source/repository';
import { InjectRepository } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { OnAppInit } from '../global/on-app-init.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { RateLimiter } from '../rate-limiting/rate-limiter';
import { FsUtilities } from '../utilities/fs.utilities';
import { EmailAttachment } from './models/email-attachment.model';
import { EmailConfig, EmailConfigInput } from './models/email-config.model';
import { EmailPriority } from './models/email-priority.enum';
import { EmailStatus } from './models/email-status.enum';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';

/**
 * Default email service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class EmailService implements EmailServiceInterface, OnAppInit, OnAppShutdown {
    /**
     * The internal nodemailer transporter.
     */
    protected readonly transporter: Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options>;
    /**
     * The email configuration.
     */
    protected readonly config: EmailConfig;
    /**
     * A rate limiter to prevent overloading the email provider.
     */
    protected readonly rateLimiter: RateLimiter;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @InjectRepository(Email)
        private readonly emailRepository: Repository<Email, CreateEmailData>,
        @Inject(ZIBRI_DI_TOKENS.EMAIL_CONFIG)
        config: EmailConfigInput | undefined
    ) {
        if (!config) {
            throw new InternalError('no email config was provided for the token "ZIBRI_DI_TOKENS.MAIL_CONFIG"');
        }
        this.config = {
            pool: true,
            ...config
        };
        this.rateLimiter = RateLimiter.perHour(this.config.maxEmailsPerHour);
        this.transporter = createTransport({ ...this.config, secure: config?.port === 465 });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        if (!app.options.cronJobs.includes(SendQueuedEmailsCronJob)) {
            app.options.cronJobs.push(SendQueuedEmailsCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppShutdown(): void {
        this.transporter.close();
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
        await this.validateAttachments(email.attachments ?? undefined);
        const res: SMTPTransport.SentMessageInfo = await this.transporter.sendMail({
            html: email.html,
            subject: email.subject,
            from: email.sender,
            to: email.recipients,
            bcc: email.bcc ?? undefined,
            cc: email.cc ?? undefined,
            attachments: email.attachments ?? undefined
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
    protected async validateAttachments(attachments: EmailAttachment[] | undefined | null): Promise<void> {
        if (!attachments?.length) {
            return;
        }

        await Promise.all(
            attachments.map(async a => {
                if (!await FsUtilities.exists(a.path)) {
                    throw new InternalError(`mail attachment at path ${a.path} does not exist`);
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
            take: amount
        });
    }
}