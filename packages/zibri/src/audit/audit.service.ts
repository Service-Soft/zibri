import { createHash, Hash } from 'node:crypto';

import { AuditBudget } from './audit-budget';
import { AuditCheckpointCronJob } from './audit-checkpoint.cron-job';
import { AuditCheckpoint, AuditCheckpointCreateData } from './audit-checkpoint.model';
import { AuditCleanupCronJob } from './audit-cleanup.cron-job';
import { AuditEntry, AuditEntryCreateData } from './audit-entry.model';
import { type AuditIntegrity } from './audit-integrity.type';
import { AuditServiceInterface } from './audit-service.interface';
import { AuditVerification, BrokenAuditTrail } from './audit-verification.model';
import { RecordedAuditEntry } from './base-audit-entry.model';
import { ChainedAuditEntry, ChainedAuditEntryCreateData } from './chained-audit-entry.model';
import { ZibriApplication } from '../application/application';
import { type EncryptionServiceInterface } from '../auth/encryption/encryption-service.interface';
import { AlsUtilities } from '../context/als.utilities';
import { HttpRequestContext } from '../context/request/http-request.context';
import { WebsocketRequestContext } from '../context/request/websocket-request.context';
import { type ChainServiceInterface } from '../data-source/chain/chain-service.interface';
import { ChainVerification } from '../data-source/chain/chain-verification.model';
import { ChainUtilities } from '../data-source/chain/chain.utilities';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { WhereFilter } from '../data-source/models/where/where-filter.model';
import { Repository } from '../data-source/repository/repository';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { BaseEntity } from '../entity/base-entity.model';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { AuditEvent, AuditOutcome } from '../logging/audit-event.model';
import { type LoggerInterface } from '../logging/logger.interface';
import { type MetricsServiceInterface } from '../metrics/metrics-service.interface';
import { TracingUtilities } from '../tracing/tracing.utilities';
import { Newable } from '../types/newable.type';
import { OmitStrict } from '../types/omit-strict.type';
import { RetentionInMs } from '../types/retention-in-ms.type';
import { Ms } from '../utilities/ms';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * How long to wait before writing again what the data source refused.
 */
const RETRY_INTERVAL_IN_MS: number = Ms.SECOND * 5;

/**
 * The name of the signing key the entries are hashed with.
 */
const SIGNING_KEY_NAME: string = 'audit';

/**
 * What a checkpoint about to be written has gathered of the entries of one tenant.
 */
type Seal = {
    /**
     * When the first of them was stored.
     */
    firstRecordedAt: Date,
    /**
     * How many there are.
     */
    count: number,
    /**
     * The digest of their keyed hashes so far.
     */
    digest: Hash
};

/**
 * Where the newest checkpoint of a tenant ends, as a grouped read answers it.
 */
type TenantPeriodEnd = Pick<AuditCheckpoint, 'tenantId'> & {
    /**
     * The end.
     */
    maximum: Date | undefined
};

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
    private readonly pending: RecordedAuditEntry[] = [];

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
        maxRefusalsPerMinute: number,
        @Inject(ZIBRI_DI_TOKENS.AUDIT_INTEGRITY)
        private readonly integrity: AuditIntegrity,
        @Inject(ZIBRI_DI_TOKENS.AUDIT_SEAL_DELAY_IN_MS)
        private readonly sealDelayInMs: number
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

    // for the reason entryRepository gives
    private get chainedEntryRepository(): Repository<ChainedAuditEntry, ChainedAuditEntryCreateData> {
        return inject(repositoryTokenFor(ChainedAuditEntry));
    }

    // for the reason entryRepository gives
    private get checkpointRepository(): Repository<AuditCheckpoint, AuditCheckpointCreateData> {
        return inject(repositoryTokenFor(AuditCheckpoint));
    }

    // read when used, since the encryption service records events of its own
    private get encryptionService(): EncryptionServiceInterface {
        return inject(ZIBRI_DI_TOKENS.ENCRYPTION_SERVICE);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    onAppInit(app: ZibriApplication): void {
        // every application records, since every one refuses something - a rate limit, a route,
        // a cross origin request - so every one needs the table and has to say how long it keeps it
        const entities: Newable<BaseEntity>[] = this.integrity === 'chain' ? [ChainedAuditEntry] : [AuditEntry, AuditCheckpoint];
        validateEntitiesRegistered(AuditService.name, app, ...entities);
        if (inject(ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS) == undefined) {
            throw new InternalError([
                'The application has to provide ZIBRI_DI_TOKENS.AUDIT_RETENTION_IN_MS,',
                'with how long an audit entry is kept (a number of milliseconds, or \'forever\').'
            ]);
        }
        if (!app.options.cronJobs.includes(AuditCleanupCronJob)) {
            app.options.cronJobs.push(AuditCleanupCronJob);
        }
        if (this.integrity === 'checkpoints' && !app.options.cronJobs.includes(AuditCheckpointCronJob)) {
            app.options.cronJobs.push(AuditCheckpointCronJob);
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
    record(event: AuditEvent, transaction?: RepositoryTransaction): void {
        // built now rather than once committed, so that the request, the tenant and the time are
        // those of the step
        const entry: RecordedAuditEntry = this.resolveEntry(event);
        // a success waits for the writes it reports, which a rollback undoes along with it. A refusal
        // happened whatever becomes of the transaction
        if (transaction != undefined && event.outcome === AuditOutcome.SUCCESS) {
            transaction.afterCommit(() => {
                this.store(event, entry);
                return Promise.resolve();
            });
            return;
        }
        this.store(event, entry);
    }

    /**
     * Logs an event and queues its entry.
     * @param event - The event.
     * @param entry - Its entry.
     */
    private store(event: AuditEvent, entry: RecordedAuditEntry): void {
        // info rather than debug so that the default db transport keeps it, and warn rather than
        // error for a failure because error() wants an Error and a refused login is not one - a
        // rule keys on metadata.audit.action, not on the level
        const reason: string = event.reason == undefined ? '' : ` (${event.reason})`;
        const message: string = `${event.action} ${event.outcome}${reason}`;
        if (event.outcome === AuditOutcome.SUCCESS) {
            this.logger.info(message, { metadata: { audit: event } });
            this.enqueue([entry]);
            return;
        }
        this.logger.warn(message, { metadata: { audit: event } });
        // never rejects: what the budget hands on is only queued here
        void this.budget.write([entry]);
    }

    /**
     * Resolves the entry of an event, with what the step it happened in knows.
     * @param event - The event.
     * @returns The entry.
     */
    private resolveEntry(event: AuditEvent): RecordedAuditEntry {
        // read now rather than when written, since the write happens outside the request and the tenant
        const requestContext: HttpRequestContext | WebsocketRequestContext | undefined = inject(ZIBRI_DI_TOKENS.CURRENT_REQUEST_CONTEXT);
        const occurredAt: Date = new Date();
        return {
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
        const cutoff: Date = new Date(Date.now() - retentionInMs);
        if (this.integrity === 'chain') {
            // from the old end of each tenant's chain, which records where the chain starts from then on
            return await this.chainedEntryRepository.prune({ lastOccurredAt: { before: cutoff } });
        }

        // a span goes as a whole once it ended before the cutoff, the entries first and then their
        // checkpoints: a run failing in between leaves checkpoints the next run finds and removes, where
        // the other order would leave entries behind that no checkpoint names any more
        const ends: TenantPeriodEnd[] = await this.checkpointRepository.maximum('periodEnd', {
            where: { periodEnd: { beforeOrOn: cutoff } },
            groupBy: ['tenantId'],
            acrossTenants: true,
            unscoped: true
        });
        const expired: WhereFilter<AuditEntry>[] = ends.flatMap(end => end.maximum == undefined
            ? []
            // eslint-disable-next-line unicorn/no-null
            : [{ tenantId: end.tenantId ?? null, recordedAt: { before: end.maximum } }]);
        const removed: number = expired.length ? await this.entryRepository.prune(expired) : 0;
        await this.checkpointRepository.prune({ periodEnd: { beforeOrOn: cutoff } });
        return removed;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async writeCheckpoints(): Promise<number> {
        if (this.integrity === 'chain') {
            return 0;
        }
        // up to a while before now rather than whole hours, so how often the cron job runs is how soon
        // an entry is sealed. The while is for an entry stored just before to have landed, also from
        // an instance whose clock runs a little behind
        const until: Date = new Date(Date.now() - this.sealDelayInMs);
        const sealedUntil: Date | undefined = await this.checkpointRepository.maximum('periodEnd', { acrossTenants: true, unscoped: true });
        // the tenants with entries since the newest checkpoint of any tenant: one whose own newest
        // checkpoint is older stored nothing in between, or it would have one up to there as well
        const unsealed: Pick<AuditEntry, 'tenantId'>[] = await this.entryRepository.count({
            where: { recordedAt: sealedUntil == undefined ? { before: until } : { afterOrOn: sealedUntil, before: until } },
            groupBy: ['tenantId'],
            acrossTenants: true,
            unscoped: true
        });
        if (!unsealed.length) {
            return 0;
        }
        // eslint-disable-next-line unicorn/no-null
        const tenantIds: (string | null)[] = unsealed.map(group => group.tenantId ?? null);
        const previousEnds: TenantPeriodEnd[] = await this.checkpointRepository.maximum('periodEnd', {
            where: tenantIds.map(tenantId => ({ tenantId })),
            groupBy: ['tenantId'],
            acrossTenants: true,
            unscoped: true
        });
        const starts: Map<string | null, Date> = new Map(previousEnds.flatMap(end => end.maximum == undefined
            ? []
            // eslint-disable-next-line unicorn/no-null
            : [[end.tenantId ?? null, end.maximum]]));

        // every tenant's entries in one read, in the order the digest takes them
        const seals: Map<string | null, Seal> = new Map();
        const entries: AsyncIterable<Pick<AuditEntry, 'tenantId' | 'recordedAt' | 'mac'>> = this.entryRepository.stream({
            where: tenantIds.map(tenantId => {
                const start: Date | undefined = starts.get(tenantId);
                return { tenantId, recordedAt: start == undefined ? { before: until } : { afterOrOn: start, before: until } };
            }),
            select: ['tenantId', 'recordedAt', 'mac'],
            order: { recordedAt: 'ASC', id: 'ASC' },
            acrossTenants: true,
            unscoped: true
        });
        for await (const entry of entries) {
            // eslint-disable-next-line unicorn/no-null
            const tenantId: string | null = entry.tenantId ?? null;
            const seal: Seal = seals.get(tenantId) ?? { firstRecordedAt: entry.recordedAt, count: 0, digest: createHash('sha256') };
            seals.set(tenantId, seal);
            seal.count++;
            seal.digest.update(entry.mac);
        }

        const written: AuditCheckpoint[] = await this.checkpointRepository.createAll([...seals].map(([tenantId, seal]) => ({
            tenantId,
            periodStart: starts.get(tenantId) ?? seal.firstRecordedAt,
            periodEnd: until,
            entryCount: seal.count,
            digest: seal.digest.digest('base64url')
        })), { acrossTenants: true });
        for (const checkpoint of written) {
            // the newest place and hash of each chain, which a copy of the log outside the data source
            // holds against a trail whose newest entries and checkpoints were removed together
            this.logger.info(`audit checkpoint ${checkpoint.chainSequence} sealed until ${until.toISOString()}`, {
                metadata: {
                    auditCheckpoint: {
                        tenantId: checkpoint.tenantId,
                        chainSequence: checkpoint.chainSequence,
                        chainHash: checkpoint.chainHash
                    }
                }
            });
        }
        return written.length;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async resolveVerification(tenantId: string | undefined): Promise<AuditVerification> {
        const chainService: ChainServiceInterface = inject(ZIBRI_DI_TOKENS.CHAIN_SERVICE);
        if (this.integrity === 'chain') {
            const chain: ChainVerification = await chainService.resolveChainVerification(ChainedAuditEntry, tenantId);
            return chain.intact
                ? { intact: true, newestSequence: chain.newestSequence, newestHash: chain.newestHash, sealedUntil: undefined }
                : { intact: false, reason: `The entry at ${chain.brokenAtSequence}: ${chain.reason}` };
        }

        const chain: ChainVerification = await chainService.resolveChainVerification(AuditCheckpoint, tenantId);
        if (!chain.intact) {
            return { intact: false, reason: `The checkpoint at ${chain.brokenAtSequence}: ${chain.reason}` };
        }
        // eslint-disable-next-line unicorn/no-null
        const owner: string | null = tenantId ?? null;
        const checkpoints: AuditCheckpoint[] = [];
        for await (const checkpoint of this.checkpointRepository.stream({
            where: { tenantId: owner },
            order: { chainSequence: 'ASC' },
            acrossTenants: true,
            unscoped: true
        })) {
            const previous: AuditCheckpoint | undefined = checkpoints.at(-1);
            if (previous != undefined && previous.periodEnd.getTime() !== checkpoint.periodStart.getTime()) {
                return {
                    intact: false,
                    reason: `The checkpoints at ${previous.chainSequence} and ${checkpoint.chainSequence} leave a gap between them.`
                };
            }
            checkpoints.push(checkpoint);
        }

        const broken: BrokenAuditTrail | undefined = await this.findBrokenSeals(owner, checkpoints);
        if (broken != undefined) {
            return broken;
        }
        return {
            intact: true,
            newestSequence: chain.newestSequence,
            newestHash: chain.newestHash,
            sealedUntil: checkpoints.at(-1)?.periodEnd
        };
    }

    /**
     * Finds the first entry of a tenant that is not as it was recorded, or the first checkpoint that
     * the entries stored in its span do not match.
     * @param owner - The tenant, or null for the entries of no tenant.
     * @param checkpoints - The checkpoints of the tenant, in the order of their chain.
     * @returns The break, or undefined when every entry and checkpoint holds.
     */
    private async findBrokenSeals(owner: string | null, checkpoints: AuditCheckpoint[]): Promise<BrokenAuditTrail | undefined> {
        const key: Buffer = await this.encryptionService.resolveSigningKey(SIGNING_KEY_NAME);
        const first: AuditCheckpoint | undefined = checkpoints[0];
        let index: number = 0;
        let count: number = 0;
        let digest: Hash = createHash('sha256');
        // from where the oldest checkpoint kept starts, since what is older was removed with the
        // checkpoints sealing it
        for await (const entry of this.entryRepository.stream({
            where: first == undefined ? { tenantId: owner } : { tenantId: owner, recordedAt: { afterOrOn: first.periodStart } },
            order: { recordedAt: 'ASC', id: 'ASC' },
            acrossTenants: true,
            unscoped: true
        })) {
            if (entry.mac !== ChainUtilities.resolveRowMac(key, AuditEntry, entry, 'mac')) {
                return { intact: false, reason: `The entry ${entry.id} is not as it was recorded.` };
            }
            for (
                let sealed: AuditCheckpoint | undefined = checkpoints[index];
                sealed != undefined && entry.recordedAt >= sealed.periodEnd;
                sealed = checkpoints[index]
            ) {
                const broken: BrokenAuditTrail | undefined = this.findBrokenSeal(sealed, count, digest);
                if (broken != undefined) {
                    return broken;
                }
                index++;
                count = 0;
                digest = createHash('sha256');
            }
            // past the newest checkpoint the entries are not sealed yet, and only their hashes tell
            if (index < checkpoints.length) {
                count++;
                digest.update(entry.mac);
            }
        }
        for (const sealed of checkpoints.slice(index)) {
            const broken: BrokenAuditTrail | undefined = this.findBrokenSeal(sealed, count, digest);
            if (broken != undefined) {
                return broken;
            }
            count = 0;
            digest = createHash('sha256');
        }
        return undefined;
    }

    /**
     * Finds what a checkpoint says that the entries stored in its span do not.
     * @param checkpoint - The checkpoint.
     * @param count - How many entries are stored in its span.
     * @param digest - The digest of their keyed hashes.
     * @returns The break, or undefined when the entries are the ones it sealed.
     */
    private findBrokenSeal(checkpoint: AuditCheckpoint, count: number, digest: Hash): BrokenAuditTrail | undefined {
        if (count === checkpoint.entryCount && digest.digest('base64url') === checkpoint.digest) {
            return undefined;
        }
        const span: string = `${checkpoint.periodStart.toISOString()} until ${checkpoint.periodEnd.toISOString()}`;
        return {
            intact: false,
            reason: `The ${count} entries stored from ${span} are not the ${checkpoint.entryCount}`
                + ` the checkpoint at ${checkpoint.chainSequence} sealed.`
        };
    }

    /**
     * Queues entries and starts writing them, unless a write is running or waiting to retry.
     *
     * At once rather than after gathering for a moment the way the logger does: what arrives while a
     * write runs is written together by the next one, so a busy minute still turns into few writes,
     * and an entry is never held back longer than one write takes.
     * @param entries - The entries.
     */
    private enqueue(entries: RecordedAuditEntry[]): void {
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
            const batch: RecordedAuditEntry[] = this.pending.splice(0, this.pending.length);
            try {
                await this.writeEntries(batch);
            }
            catch (error) {
                this.pending.unshift(...batch);
                throw error;
            }
        }
    }

    /**
     * Stores recorded entries, each with its keyed hash, or in the chains of their tenants.
     * @param batch - The entries.
     */
    private async writeEntries(batch: RecordedAuditEntry[]): Promise<void> {
        if (this.integrity === 'chain') {
            await this.chainedEntryRepository.createAll(batch, { acrossTenants: true });
            return;
        }
        const key: Buffer = await this.encryptionService.resolveSigningKey(SIGNING_KEY_NAME);
        // taken on each attempt, so an entry stored after a refusal belongs to the span it lands in
        const recordedAt: Date = new Date();
        await this.entryRepository.createAll(batch.map(entry => {
            const row: OmitStrict<AuditEntryCreateData, 'mac'> = { ...entry, recordedAt };
            return { ...row, mac: ChainUtilities.resolveRowMac(key, AuditEntry, row, 'mac') };
        }), { acrossTenants: true });
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