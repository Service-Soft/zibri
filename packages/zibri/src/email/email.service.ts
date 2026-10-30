import { EmailCleanupCronJob } from './email-cleanup.cron-job';
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
import { type GaugeInterface } from '../metrics/gauge.interface';
import { DATA_SOURCE_COLLECTOR_INTERVAL_IN_MS } from '../metrics/metrics-collector.model';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface';
import { type WakeUpServiceInterface } from '../polling/wake-up-service.interface';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { QueueDefinition } from '../queue/queue-definition.model';
import { QueueUtilities } from '../queue/queue.utilities';
import { QueuedWorkOutcome } from '../queue/queued-work-outcome.model';
import { Ms } from '../utilities/ms';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';
import { EmailConfig, EmailConfigInput } from './models/email-config.model';
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
 * What a batch of emails is sent out with: the emails, and what sends one of them.
 */
type SendManyArgs = [emails: Email[], sendEach: (email: Email) => Promise<void>];

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
        // a pass asks the rate limiter for its whole batch at once, and a bucket never holds more than
        // maxEmailsPerHour - so a larger batch would be refused on every pass, for good
        if (config.sendBatchSize != undefined && config.sendBatchSize > config.maxEmailsPerHour) {
            throw new InternalError(
                `The sendBatchSize of ${config.sendBatchSize} is more than the maxEmailsPerHour of ${config.maxEmailsPerHour},`
                + ' so no batch could ever be sent. Lower sendBatchSize to at most maxEmailsPerHour.'
            );
        }
        this.config = {
            ...config,
            sendLeaseInMs: config.sendLeaseInMs ?? Ms.MINUTE,
            sendBatchSize: config.sendBatchSize ?? Math.min(10, config.maxEmailsPerHour),
            maxSendAttempts: config.maxSendAttempts ?? 5,
            retryDelayInMs: config.retryDelayInMs ?? Ms.MINUTE
        };
    }

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by onAppInit, instead of failing on a repository token while this is built
    private get emailRepository(): Repository<Email, CreateEmailData> {
        return inject(repositoryTokenFor(Email));
    }

    private get wakeUpService(): WakeUpServiceInterface {
        return inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // every mail goes through the queue, so the table is needed whenever this is the email service
        validateEntitiesRegistered(EmailService.name, app, Email);
        inject(ZIBRI_DI_TOKENS.RATE_LIMITING_SERVICE).addLimiter(inject(ZIBRI_DI_TOKENS.EMAIL_RATE_LIMITER));
        if (!app.options.cronJobs.includes(SendQueuedEmailsCronJob)) {
            app.options.cronJobs.push(SendQueuedEmailsCronJob);
        }
        if (!app.options.cronJobs.includes(EmailCleanupCronJob)) {
            app.options.cronJobs.push(EmailCleanupCronJob);
        }
        const metricsService: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
        metricsService.addCollector({
            name: 'email queue',
            minIntervalInMs: DATA_SOURCE_COLLECTOR_INTERVAL_IN_MS,
            collect: async () => await this.collectQueueMetrics(metricsService)
        });
    }

    /**
     * Sets how many mails are queued and failed, and how long the oldest queued one has waited.
     * @param metricsService - Where the gauges are.
     */
    private async collectQueueMetrics(metricsService: MetricsServiceInterface): Promise<void> {
        // across tenants, for the reason findMails reads that way
        const [queued, failed, [oldest]] = await Promise.all([
            this.emailRepository.count({ where: { status: EmailStatus.QUEUED }, acrossTenants: true }),
            this.emailRepository.count({ where: { status: EmailStatus.FAILED }, acrossTenants: true }),
            this.emailRepository.findAll({ where: { status: EmailStatus.QUEUED }, limit: 1, acrossTenants: true })
        ]);
        const depth: GaugeInterface = metricsService.getGauge('email_queue_depth', ['status']);
        depth.set({ status: EmailStatus.QUEUED }, queued);
        depth.set({ status: EmailStatus.FAILED }, failed);
        metricsService.getGauge('email_queue_oldest_age_seconds')
            .set({}, oldest == undefined ? 0 : (Date.now() - oldest.createdAt.getTime()) / Ms.SECOND);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
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
        // whichever instance sends the queue looks at its next pass, however long it found nothing
        await this.wakeUpService.wake(this.emailRepository.dataSource, WAKE_UP_TOPICS.EMAILS);
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
        return await QueueUtilities.poll(this.resolveQueue(span));
    }

    /**
     * Resolves the queue of mails: which are due, how a batch of them is sent, and what becomes of
     * a mail after its attempt.
     * @param span - The span of the pass, for recording how much it turned out to be.
     * @returns The queue.
     */
    private resolveQueue(span: TraceSpanInterface): QueueDefinition<Email> {
        return {
            name: 'email',
            wakeUpTopic: WAKE_UP_TOPICS.EMAILS,
            dataSource: this.emailRepository.dataSource,
            leaseInMs: this.config.sendLeaseInMs,
            // claimed together, and before anything is sent or the rate limiter is asked for tokens:
            // the status is only written back once a send returns, so until then these rows still
            // read as QUEUED to every other instance. A send that throws is counted on its own mail
            // and backs off through its nextAttemptAt, so the claims are released. 'retainOnError'
            // is the backoff for what is left: recording an attempt itself failing
            onCompletion: 'retainOnError',
            claimedPer: 'batch',
            firstRetryDelayInMs: this.config.retryDelayInMs,
            findDue: async () => await this.findDueMails(),
            findRunId: email => email.id,
            findMaxAttempts: () => this.config.maxSendAttempts,
            run: async email => await this.sendInTenantOf(email),
            runBatch: async (emails, runEach) => {
                span.recordAttributes({ 'messaging.destination.name': 'email', 'db.response.returned_rows': emails.length });
                try {
                    await this.sendMany(emails, runEach);
                    return true;
                }
                catch (error) {
                    // rate limited: the claims are released, so the next window can send them
                    if (error instanceof TooManyRequestsError) {
                        return false;
                    }
                    throw error;
                }
            },
            record: async (email, outcome) => await this.recordAttempt(email, outcome),
            resolveGiveUpError: (email, cause) => new InternalError(
                `mail ${email.id} could not be sent after ${this.config.maxSendAttempts} attempts`,
                { cause }
            )
        };
    }

    /**
     * Finds the mails due now, the more urgent ones first.
     * @returns The mails, at most `sendBatchSize` of them.
     */
    private async findDueMails(): Promise<Email[]> {
        const emails: Email[] = [];
        for (const [i, priority] of prioritiesInSendOrder.entries()) {
            // one slot held back for each priority still to come, so a permanent flood of HIGH
            // cannot take the whole pass and leave NORMAL and LOW never sent. The 8 and the 10 - 1
            // this replaces were that same reservation, written as numbers rather than as the rule
            // they came from - which is why neither could be configured. Only in a batch with a slot for
            // every priority: in a smaller one the reservations took every slot from the higher
            // priorities, and only LOW was ever sent
            const reservedForLower: number = this.config.sendBatchSize >= prioritiesInSendOrder.length
                ? prioritiesInSendOrder.length - 1 - i
                : 0;
            const amount: number = this.config.sendBatchSize - emails.length - reservedForLower;
            if (amount <= 0) {
                continue;
            }
            emails.push(...await this.findMails(priority, amount));
        }
        return emails;
    }

    /**
     * Sends out the given emails.
     * @param emails - The emails to send out.
     * @param sendEach - Sends one of them, and records how its attempt ended.
     */
    // one bucket for the whole application on purpose: maxEmailsPerHour is what the mail server will
    // accept, not what any one caller may ask for. Said explicitly, because the default counts per
    // caller - and a mail sent while handling a request would otherwise be counted against whoever
    // happened to trigger it.
    @RateLimited(ZIBRI_DI_TOKENS.EMAIL_RATE_LIMITER, {
        countFn: (...[emails]: SendManyArgs) => emails.length,
        keyFn: RateLimitKeys.GLOBAL
    })
    protected async sendMany(emails: Email[], sendEach: (email: Email) => Promise<void>): Promise<void> {
        // each mail on its own, so one that cannot be sent holds back none of the others in its batch
        await Promise.all(emails.map(sendEach));
    }

    /**
     * Records how an attempt at a mail ended. A mail that was sent was written by its send already;
     * one whose send threw is tried again later, or marked FAILED once it used up `maxSendAttempts`.
     * @param email - The email.
     * @param outcome - How its attempt ended.
     */
    private async recordAttempt(email: Email, outcome: QueuedWorkOutcome): Promise<void> {
        if (outcome.kind === 'succeeded') {
            return;
        }
        const status: EmailStatus = outcome.kind === 'failed' ? EmailStatus.FAILED : EmailStatus.QUEUED;
        // across tenants, for the reason findMails reads that way
        await this.emailRepository.updateById(
            email.id,
            { status, attempts: outcome.attempts, nextAttemptAt: outcome.nextAttemptAt, error: outcome.error },
            { acrossTenants: true }
        );
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
                { status: EmailStatus.QUEUED, priority, nextAttemptAt: null },
                { status: EmailStatus.QUEUED, priority, nextAttemptAt: { before: new Date() } }
            ],
            limit: amount,
            // one queue for every tenant: the mail server and its limit are the deployment's
            acrossTenants: true
        });
    }
}