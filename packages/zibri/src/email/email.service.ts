import { EmailServiceInterface } from './email-service.interface';
import { ZibriApplication } from '../application/application';
import { CreateEmailData, QueueEmailData } from './models/create-email-data.model';
import { Email } from './models/email.model';
import { SendQueuedEmailsCronJob } from './send-queued-emails.cron-job';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { TooManyRequestsError } from '../error-handling/errors/too-many-requests.error';
import { OnAppInit } from '../global/on-app-init.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { FsUtilities } from '../utilities/fs.utilities';
import { Ms } from '../utilities/ms';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';
import { EmailAttachment } from './models/email-attachment.model';
import { EmailConfig, EmailConfigInput } from './models/email-config.model';
import { type LeaseServiceInterface } from '../leases/lease-service.interface';
import { EmailPriority } from './models/email-priority.enum';
import { EmailStatus } from './models/email-status.enum';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { RateLimited } from '../rate-limiting/decorators/rate-limited.decorator';
import { RateLimitKeys } from '../rate-limiting/rate-limit-keys';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface';
import { TraceSpanKind } from '../tracing/trace-span-kind.enum';
import { TraceSpanInterface } from '../tracing/trace-span.interface';
import { TracingUtilities } from '../tracing/tracing.utilities';
import { type EmailSendResult, type EmailTransportInterface } from './transports/email-transport.interface';

/**
 * The priorities a queued mail can have, most urgent first.
 *
 * The order the queue is drained in, and what the per priority caps are derived from - so adding a
 * priority is one entry here rather than a second magic number somewhere else.
 */
const prioritiesInSendOrder: EmailPriority[] = [EmailPriority.HIGH, EmailPriority.NORMAL, EmailPriority.LOW];

/**
 * Names the grant on one queued mail.
 *
 * Prefixed, because the lease key space is shared with every other thing the framework and the
 * application take a grant on.
 * @param email - The mail being claimed.
 * @returns The lease key.
 */
function claimKeyFor(email: Email): string {
    return `email:${email.id}`;
}

/**
 * Default email service implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class EmailService implements EmailServiceInterface, OnAppInit, OnAppShutdown {
    /**
     * The email configuration.
     */
    protected readonly config: EmailConfig;
    /**
     * What actually delivers a mail.
     */
    protected readonly transport: EmailTransportInterface;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.LEASE_SERVICE)
        private readonly leaseService: LeaseServiceInterface,
        @Inject(ZIBRI_DI_TOKENS.EMAIL_CONFIG)
        config: EmailConfigInput | undefined,
        @Inject(ZIBRI_DI_TOKENS.EMAIL_TRANSPORT)
        transport: EmailTransportInterface | undefined
    ) {
        if (!config) {
            throw new InternalError('no email config was provided for the token "ZIBRI_DI_TOKENS.EMAIL_CONFIG"');
        }
        // required rather than defaulted to smtp, because there is no default that works: every smtp
        // transport needs a host, a port and credentials that only the deployment knows. Naming the
        // shipped one here is what keeps that from being a puzzle
        if (!transport) {
            throw new InternalError(
                'no email transport was provided for the token "ZIBRI_DI_TOKENS.EMAIL_TRANSPORT".'
                + ' Register one - "new SmtpEmailTransport({ host, port, auth })" is the transport Zibri ships'
            );
        }
        this.transport = transport;
        this.config = {
            ...config,
            sendLeaseInMs: config.sendLeaseInMs ?? Ms.MINUTE,
            sendBatchSize: config.sendBatchSize ?? 10
        };
    }

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by onAppInit, instead of failing on a repository token while this is built
    private get emailRepository(): Repository<Email, CreateEmailData> {
        return inject(repositoryTokenFor(Email));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // every mail goes through the queue, so the table is needed whenever this is the email service
        validateEntitiesRegistered(EmailService.name, app, Email);
        if (!app.options.cronJobs.includes(SendQueuedEmailsCronJob)) {
            app.options.cronJobs.push(SendQueuedEmailsCronJob);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppShutdown(): Promise<void> {
        await this.transport.close?.();
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
        // a trace of its own: a pass over the queue is not part of whichever request happened to
        // queue one of the mails it picks up, and usually none of them was queued by a request at
        // all
        return await TracingUtilities.trace('sendQueuedEmails', { root: true, kind: TraceSpanKind.PRODUCER }, async span => {
            const sent: boolean = await this.sendQueuedBatch(span);
            return sent;
        });
    }

    /**
     * One pass over the queue.
     * @param span - The span of the pass, for recording how much it turned out to be.
     * @returns Whether anything was sent.
     */
    private async sendQueuedBatch(span: TraceSpanInterface): Promise<boolean> {
        const emails: Email[] = [];
        for (const [i, priority] of prioritiesInSendOrder.entries()) {
            // one slot held back for each priority still to come, so a permanent flood of HIGH
            // cannot take the whole pass and leave NORMAL and LOW never sent. The 8 and the 10 - 1
            // this replaces were that same reservation, written as numbers rather than as the rule
            // they came from - which is why neither could be configured
            const reservedForLower: number = prioritiesInSendOrder.length - 1 - i;
            const amount: number = this.config.sendBatchSize - emails.length - reservedForLower;
            if (amount <= 0) {
                continue;
            }
            emails.push(...await this.findMails(priority, amount));
        }

        if (!emails.length) {
            return false;
        }

        span.recordAttributes({ 'messaging.destination.name': 'email', 'db.response.returned_rows': emails.length });

        const byKey: Map<string, Email> = new Map(emails.map(e => [claimKeyFor(e), e]));

        // claimed before anything is sent, and before the rate limiter is asked for tokens: the
        // status is only written back once a send returns, so until then these rows still read as
        // QUEUED to every other instance - and to this one's next tick, if a send outlasts the
        // interval between two of them.
        //
        // Per mail rather than per batch, because the next batch a moment later is a different set
        // of mails and would otherwise be free to take one that is still being sent.
        //
        // 'retainOnError' is the backoff: a send that died halfway is not handed straight back to
        // whichever instance asks next, it waits out the lease. A TooManyRequestsError is caught
        // below and returns normally, so the rate limited case does release and the next window can
        // send them.
        const sent: boolean | undefined = await this.leaseService.withLeases(
            [...byKey.keys()],
            { leaseInMs: this.config.sendLeaseInMs, onCompletion: 'retainOnError' },
            async taken => {
                try {
                    await this.sendMany(taken.map(k => byKey.get(k)).filter((e): e is Email => e != undefined));
                    return true;
                }
                catch (error) {
                    if (error instanceof TooManyRequestsError) {
                        return false;
                    }
                    throw error;
                }
            }
        );

        // undefined means somebody else holds every one of them. Returning true would spin: the
        // same rows come back on the next pass and the same claims fail.
        return sent ?? false;
    }

    /**
     * Sends out the given emails.
     * @param emails - The emails to send out.
     */
    // one bucket for the whole application on purpose: maxEmailsPerHour is what the mail server will
    // accept, not what any one caller may ask for. Said explicitly, because the default counts per
    // caller - and a mail sent while handling a request would otherwise be counted against whoever
    // happened to trigger it.
    @RateLimited(ZIBRI_DI_TOKENS.EMAIL_RATE_LIMITER, { countFn: emails => emails.length, keyFn: RateLimitKeys.GLOBAL })
    protected async sendMany(emails: Email[]): Promise<void> {
        await Promise.all(emails.map(m => this.sendInTenantOf(m)));
    }

    /**
     * Sends out the given email in the tenant it was queued in.
     *
     * The queue is drained from outside every tenant, so the transport, and whatever it logs, would
     * otherwise act for no tenant.
     * @param email - The email to send out.
     */
    private async sendInTenantOf(email: Email): Promise<void> {
        if (email.tenantId == undefined) {
            await this.send(email);
            return;
        }
        const tenantService: TenantServiceInterface = inject(ZIBRI_DI_TOKENS.TENANT_SERVICE);
        await tenantService.runAs(email.tenantId, async () => await this.send(email));
    }

    /**
     * Sends out the given email.
     * @param email - The email to send out.
     */
    protected async send(email: Email): Promise<void> {
        await this.validateAttachments(email.attachments ?? undefined);
        // a transport that could not reach its provider throws, which leaves the row QUEUED and the
        // claim on it retained - so nothing below runs for a mail that was never delivered. What it
        // answers is a verdict from the provider, which is the only thing that may end a mail
        const res: EmailSendResult = await this.transport.send(email);

        const status: EmailStatus = res.rejectedRecipients.length ? EmailStatus.FAILED : EmailStatus.SENT;

        // a failed mail keeps its row whatever `persist` says. `persist` answers what to do with a
        // mail that was sent - deleting one that was not destroys the only record that it was ever
        // owed, and leaves a rejected password reset or 2fa code with nothing behind it but a log
        // line. The row stays FAILED, which findMails does not pick up, so this is a record rather
        // than a retry.
        // across tenants, for the reason findMails reads that way
        if (status === EmailStatus.FAILED) {
            const rejectedRecipients: string[] = res.rejectedRecipients;
            this.logger.warn(`mail to ${rejectedRecipients.join(', ')} was rejected`);
            await this.emailRepository.updateById(email.id, { status, rejectedRecipients }, { acrossTenants: true });
            return;
        }

        if (email.persist) {
            await this.emailRepository.updateById(email.id, { status }, { acrossTenants: true });
            return;
        }

        await this.emailRepository.deleteById(email.id, { acrossTenants: true });
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
            take: amount,
            // one queue for every tenant: the mail server and its limit are the deployment's
            acrossTenants: true
        });
    }
}