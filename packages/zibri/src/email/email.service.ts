import { EmailCleanupCronJob } from './email-cleanup.cron-job.ts';
import { EmailServiceInterface } from './email-service.interface.ts';
import { ZibriApplication } from '../application/application.ts';
import { CreateEmailData, QueueEmailData } from './models/create-email-data.model.ts';
import { Email } from './models/email.model.ts';
import { SendQueuedEmailsCronJob } from './send-queued-emails.cron-job.ts';
import { Repository } from '../data-source/repository/repository.ts';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator.ts';
import { Inject } from '../di/decorators/inject.decorator.ts';
import { Injectable } from '../di/decorators/injectable.decorator.ts';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default.ts';
import { inject } from '../di/inject.function.ts';
import { TooManyRequestsError } from '../error-handling/errors/too-many-requests.error.ts';
import { OnAppInit } from '../global/on-app-init.interface.ts';
import { type LoggerInterface } from '../logging/logger.interface.ts';
import { FsUtilities } from '../utilities/fs.utilities.ts';
import { Ms } from '../utilities/ms.ts';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function.ts';
import { EmailAttachment } from './models/email-attachment.model.ts';
import { EmailConfig, EmailConfigInput } from './models/email-config.model.ts';
import { type LeaseServiceInterface } from '../leases/lease-service.interface.ts';
import { EmailPriority } from './models/email-priority.enum.ts';
import { EmailStatus } from './models/email-status.enum.ts';
import { InternalError } from '../error-handling/internal-error.model.ts';
import { OnAppShutdown } from '../global/on-app-shutdown.interface.ts';
import { RateLimited } from '../rate-limiting/decorators/rate-limited.decorator.ts';
import { RateLimitKeys } from '../rate-limiting/rate-limit-keys.ts';
import { type TenantServiceInterface } from '../tenancy/tenant-service.interface.ts';
import { TraceSpanKind } from '../tracing/trace-span-kind.enum.ts';
import { TraceSpanInterface } from '../tracing/trace-span.interface.ts';
import { TracingUtilities } from '../tracing/tracing.utilities.ts';
import { type EmailSendResult, type EmailTransportInterface } from './transports/email-transport.interface.ts';

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
            sendBatchSize: config.sendBatchSize ?? 10,
            maxSendAttempts: config.maxSendAttempts ?? 5,
            retryDelayInMs: config.retryDelayInMs ?? Ms.MINUTE
        };
    }

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by onAppInit, instead of failing on a repository token while this is built
    private get emailRepository(): Repository<Email, CreateEmailData> {
        return inject(repositoryTokenFor(Email));
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // every mail goes through the queue, so the table is needed whenever this is the email service
        validateEntitiesRegistered(EmailService.name, app, Email);
        if (!app.options.cronJobs.includes(SendQueuedEmailsCronJob)) {
            app.options.cronJobs.push(SendQueuedEmailsCronJob);
        }
        if (!app.options.cronJobs.includes(EmailCleanupCronJob)) {
            app.options.cronJobs.push(EmailCleanupCronJob);
        }
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async deleteExpiredFailedEmails(): Promise<number> {
        if (this.config.failedRetentionInMs === 'forever') {
            return 0;
        }
        // counted from when the mail was queued, which no row lacks: a mail fails within minutes of
        // that unless the queue is backed up, and a retention is counted in days
        return await this.emailRepository.deleteAll(
            { status: EmailStatus.FAILED, createdAt: { before: new Date(Date.now() - this.config.failedRetentionInMs) } },
            // the queue is every tenant's, for the reason findMails reads that way
            { acrossTenants: true }
        );
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async onAppShutdown(): Promise<void> {
        await this.transport.close?.();
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
    async queue(data: QueueEmailData): Promise<void> {
        await this.emailRepository.create({
            status: EmailStatus.QUEUED,
            priority: EmailPriority.NORMAL,
            persist: false,
            sender: this.config.defaultSender,
            ...data
        });
    }

    // eslint-disable-next-line jsdoc-js/require-jsdoc
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
        // a send that throws is counted on its own mail and backs off through its retryAt, so the work
        // returns normally and the claims are released. 'retainOnError' is the backoff for what is
        // left: recording the attempt itself failing, which leaves nothing on the rows to wait by. A
        // TooManyRequestsError is caught below and returns normally, so the rate limited case does
        // release and the next window can send them.
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
        await Promise.all(emails.map(m => this.sendCountingAttempts(m)));
    }

    /**
     * Sends out the given email, and counts an attempt on it when the send throws.
     *
     * Each mail on its own, so one that cannot be sent holds back none of the others in its batch.
     * @param email - The email to send out.
     */
    private async sendCountingAttempts(email: Email): Promise<void> {
        try {
            await this.sendInTenantOf(email);
        }
        catch (error) {
            // a mail that threw used to stay QUEUED at the head of its priority, tried again every
            // minute forever and keeping the claims of its whole batch (04 §2.14)
            await this.recordFailedAttempt(email, error);
        }
    }

    /**
     * Records that sending an email threw: it is tried again later, waiting twice as long after
     * every attempt, and marked FAILED once it has used up `maxSendAttempts`.
     * @param email - The email.
     * @param error - What its send threw.
     */
    private async recordFailedAttempt(email: Email, error: unknown): Promise<void> {
        const attempts: number = email.attempts + 1;
        const cause: InternalError = new InternalError(
            `mail ${email.id} could not be sent (attempt ${attempts} of ${this.config.maxSendAttempts})`,
            { cause: error }
        );
        // across tenants, for the reason findMails reads that way
        if (attempts >= this.config.maxSendAttempts) {
            this.logger.error(cause);
            await this.emailRepository.updateById(email.id, { status: EmailStatus.FAILED, attempts }, { acrossTenants: true });
            return;
        }
        this.logger.warn(cause.message);
        const retryAt: Date = new Date(Date.now() + (this.config.retryDelayInMs * (2 ** (attempts - 1))));
        await this.emailRepository.updateById(email.id, { attempts, retryAt }, { acrossTenants: true });
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
            // a mail whose send threw is passed over until it is due, so the ones behind it are sent
            where: [
                // eslint-disable-next-line unicorn/no-null
                { status: EmailStatus.QUEUED, priority, retryAt: null },
                { status: EmailStatus.QUEUED, priority, retryAt: { before: new Date() } }
            ],
            take: amount,
            // one queue for every tenant: the mail server and its limit are the deployment's
            acrossTenants: true
        });
    }
}