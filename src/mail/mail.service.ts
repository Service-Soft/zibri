import { createReadStream } from 'fs';

import { createTransport, Transporter } from 'nodemailer';
import SMTPTransport from 'nodemailer/lib/smtp-transport';

import { Repository } from '../data-source';
import { inject, repositoryTokenFor, ZIBRI_DI_TOKENS } from '../di';
import { MailServiceInterface } from './mail-service.interface';
import { CreateMailData, Mail, MailAttachment, MailConfig, MailPriority, MailStatus, QueueMailData, ResolvedMailAttachment } from './models';
import { ZibriApplication } from '../application';
import { pathExists } from '../utilities';
import { SendQueuedMailsCronJob } from './send-queued-mails.cron-job';
import { LoggerInterface } from '../logging';
import { RateLimiter } from '../rate-limiting';

export class MailService implements MailServiceInterface {

    protected readonly transporter: Transporter<SMTPTransport.SentMessageInfo, SMTPTransport.Options>;
    protected readonly mailRepository: Repository<Mail, CreateMailData>;
    protected readonly config: MailConfig;
    protected readonly rateLimiter: RateLimiter;
    protected readonly logger: LoggerInterface;

    constructor() {
        this.mailRepository = inject(repositoryTokenFor(Mail));
        const config: MailConfig | undefined = inject(ZIBRI_DI_TOKENS.MAIL_CONFIG);
        if (!config) {
            throw new Error('no mail config was provided for the token "ZIBRI_DI_TOKENS.MAIL_CONFIG"');
        }
        this.config = config;
        this.rateLimiter = RateLimiter.perHour(this.config.maxEmailsPerHour);
        this.transporter = createTransport({ ...this.config, secure: config?.port === 465 });
        this.logger = inject(ZIBRI_DI_TOKENS.LOGGER);
    }

    attachTo(app: ZibriApplication): void {
        app['options'].cronJobs.push(SendQueuedMailsCronJob);
    }

    async queue(data: QueueMailData): Promise<void> {
        await this.mailRepository.create({
            status: MailStatus.QUEUED,
            priority: MailPriority.NORMAL,
            persist: false,
            ...data
        });
    }

    async sendQueuedMails(): Promise<boolean> {
        const highMails: Mail[] = await this.findMails(MailPriority.HIGH, 8);
        const normalMails: Mail[] = await this.findMails(MailPriority.NORMAL, 10 - 1 - highMails.length);
        const lowMails: Mail[] = await this.findMails(MailPriority.LOW, 10 - highMails.length - normalMails.length);
        const mails: Mail[] = [...highMails, ...normalMails, ...lowMails];

        if (!mails.length || !this.rateLimiter.isAvailable(mails.length)) {
            return false;
        }

        await Promise.all(mails.map(m => this.send(m)));
        return true;
    }

    protected async send(mail: Mail): Promise<void> {
        const res: SMTPTransport.SentMessageInfo = await this.transporter.sendMail({
            html: mail.html,
            subject: mail.subject,
            from: mail.sender,
            to: mail.recipients,
            bcc: mail.bcc,
            cc: mail.cc,
            attachments: await this.resolveAttachments(mail.attachments)
        });

        const status: MailStatus = res.rejected.length ? MailStatus.FAILED : MailStatus.SENT;

        if (status === MailStatus.FAILED) {
            const rejectedRecipients: string[] = res.rejected.map((e) => typeof e === 'string' ? e : e.address);
            this.logger.error(`mail to ${rejectedRecipients.join(', ')} was rejected`);
        }

        if (mail.persist) {
            await this.mailRepository.updateById(mail.id, { status });
            return;
        }

        await this.mailRepository.deleteById(mail.id);
    }

    protected async resolveAttachments(attachments: MailAttachment[] | undefined): Promise<ResolvedMailAttachment[]> {
        if (!attachments?.length) {
            return [];
        }

        return await Promise.all(
            attachments.map(async a => {
                if (!await pathExists(a.path)) {
                    throw new Error(`mail attachment at path ${a.path} does not exist`);
                }
                return {
                    filename: a.name,
                    content: createReadStream(a.path)
                };
            })
        );
    }

    private async findMails(priority: MailPriority, amount: number): Promise<Mail[]> {
        return await this.mailRepository.findAll({
            where: {
                status: MailStatus.QUEUED,
                priority
            },
            take: amount,
            order: { createdAt: 'ASC' }
        });
    }
}