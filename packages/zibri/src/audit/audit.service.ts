import { AuditBudget } from './audit-budget';
import { AuditCleanupCronJob } from './audit-cleanup.cron-job';
import { AuditEntry, AuditEntryCreateData } from './audit-entry.model';
import { AuditServiceInterface } from './audit-service.interface';
import { ZibriApplication } from '../application/application';
import { AlsUtilities } from '../context/als.utilities';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { AuditEvent, AuditOutcome } from '../logging/audit-event.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface';
import { TracingUtilities } from '../tracing/tracing.utilities';
import { RetentionInMs } from '../types/retention-in-ms.type';
import { Ms } from '../utilities/ms';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * How long to wait before writing again what the data source refused.
 */
const RETRY_INTERVAL_IN_MS: number = Ms.SECOND * 5;

/**
 * Default audit implementation of Zibri.
 */
@Injectable({ register: 'onUse' })
export class AuditService implements AuditServiceInterface, OnAppInit, OnAppShutdown {

    /**
     * Entries waiting to be written, oldest first.
     *
     * Not bounded the way the log buffer is, because nothing in here may be dropped. What bounds it
     * is who decides the volume: a refusal past the budget is counted rather than queued, so a
     * flood adds one entry per kind, and a success is something that passed a check.
     */
    private readonly pending: AuditEntryCreateData[] = [];

    /**
     * The write currently running, if there is one.
     */
    private writing: Promise<void> | undefined;

    /**
     * The timer waiting to write again what the data source refused, if it refused something.
     */
    private retry: NodeJS.Timeout | undefined;

    private readonly budget: AuditBudget;

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.AUDIT_MAX_REFUSALS_PER_MINUTE)
        maxRefusalsPerMinute: number
    ) {
        this.budget = new AuditBudget(maxRefusalsPerMinute, entries => {
            this.enqueue(entries);
            return Promise.resolve();
        });
    }

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by onAppInit, instead of failing on a repository token while this is built
    private get entryRepository(): Repository<AuditEntry, AuditEntryCreateData> {
        return inject(repositoryTokenFor(AuditEntry));
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // every application records, since every one refuses something - a rate limit, a route,
        // a cross origin request - so every one needs the table and has to say how long it keeps it
        validateEntitiesRegistered(AuditService.name, app, AuditEntry);
        if (inject(ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS) == undefined) {
            throw new InternalError([
                'The application has to provide ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS,',
                'with how long an audit entry is kept (a number of milliseconds, or \'forever\').'
            ]);
        }
        if (!app.options.cronJobs.includes(AuditCleanupCronJob)) {
            app.options.cronJobs.push(AuditCleanupCronJob);
        }
        const metricsService: MetricsServiceInterface = inject(ZIBRI_DI_TOKENS.METRICS_SERVICE);
        metricsService.addCollector({
            name: 'audit trail',
            // what this process holds, so nothing to spare
            minIntervalInMs: 0,
            collect: () => {
                metricsService.getGauge('audit_entries_pending').set({}, this.pending.length);
                return Promise.resolve();
            }
        });
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async onAppShutdown(): Promise<void> {
        try {
            await this.flush();
        }
        catch (error) {
            // eslint-disable-next-line no-console
            console.error(`Could not store ${this.pending.length} audit entries before shutting down`, error);
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    record(event: AuditEvent): void {
        // info rather than debug so that the default db transport keeps it, and warn rather than
        // error for a failure because error() wants an Error and a refused login is not one - a
        // rule keys on metadata.audit.action, not on the level
        const reason: string = event.reason == undefined ? '' : ` (${event.reason})`;
        const message: string = `${event.action} ${event.outcome}${reason}`;
        if (event.outcome === AuditOutcome.SUCCESS) {
            this.logger.info(message, { metadata: { audit: event } });
        }
        else {
            this.logger.warn(message, { metadata: { audit: event } });
        }

        // read now rather than when written, since the write happens outside the request and the tenant
        const requestContext: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const occurredAt: Date = new Date();
        const entry: AuditEntryCreateData = {
            ...event,
            // null rather than undefined for no tenant, since the write fills an undefined one with
            // the tenant it runs in - which is whichever entry happened to start it
            // eslint-disable-next-line unicorn/no-null
            tenantId: AlsUtilities.getCurrentTenant() ?? null,
            clientIp: requestContext?.type === 'http-request'
                ? requestContext.request.ip ?? requestContext.request.socket?.remoteAddress
                : undefined,
            traceId: TracingUtilities.getCurrentTraceContext()?.traceId,
            occurredAt,
            lastOccurredAt: occurredAt,
            count: 1
        };

        if (event.outcome === AuditOutcome.SUCCESS) {
            this.enqueue([entry]);
            return;
        }
        // never rejects: what the budget hands on is only queued here
        void this.budget.write([entry]);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async flush(): Promise<void> {
        await this.budget.flush();
        clearTimeout(this.retry);
        this.retry = undefined;
        // never rejects: it reports a failure itself, and what it held is pending again
        await this.writing;
        try {
            await this.writePending();
        }
        catch (error) {
            this.scheduleRetry();
            throw error;
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async deleteExpiredEntries(): Promise<number> {
        const retentionInMs: RetentionInMs | undefined = inject(ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS);
        if (retentionInMs == undefined || retentionInMs === 'forever') {
            return 0;
        }
        return await this.entryRepository.deleteAll(
            { lastOccurredAt: { before: new Date(Date.now() - retentionInMs) } },
            { acrossTenants: true }
        );
    }

    /**
     * Queues entries and starts writing them, unless a write is running or waiting to retry.
     *
     * At once rather than after gathering for a moment the way the logger does: what arrives while a
     * write runs is written together by the next one, so a busy minute still turns into few writes,
     * and an entry is never held back longer than one write takes.
     * @param entries - The entries.
     */
    private enqueue(entries: AuditEntryCreateData[]): void {
        this.pending.push(...entries);
        if (this.writing || this.retry) {
            return;
        }
        this.writing = this.writeInBackground();
    }

    /**
     * Writes what is pending, and arranges to try again when the data source refuses it.
     */
    private async writeInBackground(): Promise<void> {
        try {
            await this.writePending();
        }
        catch (error) {
            this.logger.error(new Error(`Could not store ${this.pending.length} audit entries, trying again`, { cause: error }));
            this.scheduleRetry();
        }
        finally {
            this.writing = undefined;
        }
    }

    /**
     * Writes everything pending, including what arrives while it runs. What the data source refuses
     * is pending again, in front of what arrived meanwhile.
     */
    private async writePending(): Promise<void> {
        while (this.pending.length) {
            const batch: AuditEntryCreateData[] = this.pending.splice(0, this.pending.length);
            try {
                await this.entryRepository.createAll(batch, { acrossTenants: true });
            }
            catch (error) {
                this.pending.unshift(...batch);
                throw error;
            }
        }
    }

    /**
     * Arranges to write what is pending again after a while.
     *
     * Unref'd, so it never holds the process open. Shutdown flushes.
     */
    private scheduleRetry(): void {
        if (this.retry) {
            return;
        }
        this.retry = setTimeout(() => {
            this.retry = undefined;
            this.writing ??= this.writeInBackground();
        }, RETRY_INTERVAL_IN_MS);
        this.retry.unref();
    }
}