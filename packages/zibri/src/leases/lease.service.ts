import { HeldLease, KeptGrant } from './held-lease.model';
import { LeaseAcquisitionTimeoutError } from './lease-acquisition-timeout.error';
import { LeaseLostError } from './lease-lost.error';
import { LeaseAcquisitionMode, LeaseOptions, LeaseSetOptions } from './lease-options.model';
import { LeaseServiceInterface } from './lease-service.interface';
import { CreateLeaseData, Lease } from './lease.model';
import { ZibriApplication } from '../application/application';
import { AlsUtilities } from '../context/als.utilities';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { dataSourceNow } from '../data-source/models/data-source-now.function';
import { Repository } from '../data-source/repository/repository';
import { runInLeaseScope } from '../data-source/run-in-lease-scope.function';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { repositoryTokenFor } from '../di/decorators/inject-repository.decorator';
import { Inject } from '../di/decorators/inject.decorator';
import { Injectable } from '../di/decorators/injectable.decorator';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { OnAppInit } from '../global/on-app-init.interface';
import { OnAppShutdown } from '../global/on-app-shutdown.interface';
import { type LoggerInterface } from '../logging/logger.interface';
import { WakeUpListener } from '../polling/wake-up-listener.model';
import { type WakeUpServiceInterface } from '../polling/wake-up-service.interface';
import { WAKE_UP_TOPICS } from '../polling/wake-up-topics';
import { Ms } from '../utilities/ms';
import { PromiseUtilities } from '../utilities/promise.utilities';
import { validateEntitiesRegistered } from '../utilities/validate-entities-registered.function';

/**
 * How long to wait between attempts in 'wait' mode, on a data source that carries no wake ups between
 * instances.
 */
const ACQUIRE_RETRY_INTERVAL_IN_MS: number = 100;

/**
 * How long to wait between attempts in 'wait' mode, when whoever hands the grant back says so. Only
 * for the release nobody announces: a holder that stopped existing, whose grant lapses on its own.
 */
const ACQUIRE_FALLBACK_INTERVAL_IN_MS: number = Ms.SECOND;

/**
 * How many times a grant is renewed within its own lifetime.
 *
 * Three, so two renewals have to fail in a row before it is allowed to lapse. Renewing once per
 * lifetime would mean a single slow round trip loses it.
 */
const RENEWALS_PER_LEASE: number = 3;

/**
 * How the work a grant protects ended.
 *
 * Three states rather than two, because "has not ended" is a real answer: the shutdown drain gives
 * up on work that is still running and frees its grant, and a grant whose work never completed must
 * go back whatever the completion says. Retaining one is a claim that the work has been done.
 */
type LeaseWorkOutcome = 'unfinished' | 'completed' | 'threw';

// Without renewal, "the work must be faster than the lease" is an unwritten precondition that
// nothing enforces.
/**
 * Holds the grants that let one replica do a piece of work the others must not.
 *
 * Every lease gets two things the caller does not have to arrange. Renewal, because a grant is
 * handed out for a fixed time while the work it protects may legitimately take longer. And a
 * shutdown that drains, because a replica going away gracefully still holds grants, and whoever
 * takes over otherwise waits out a full lease for work that stopped a second ago.
 *
 * What a grant *is* stays with whoever took it - a valkey key for a named lock, a row for a claim on
 * an event or a queued mail. This only deals in the operations they share.
 */
@Injectable({ register: 'onUse' })
export class LeaseService implements LeaseServiceInterface, OnAppInit, OnAppShutdown {
    private readonly inFlight: Map<HeldLease, Promise<unknown>> = new Map();

    /**
     * Recorded on every grant so it is possible to tell which instance holds one.
     */
    private holder: string = '';

    constructor(
        @Inject(ZIBRI_DI_TOKENS.LOGGER)
        private readonly logger: LoggerInterface,
        @Inject(ZIBRI_DI_TOKENS.LEASE_DRAIN_TIMEOUT_IN_MS)
        private readonly drainTimeoutInMs: number,
        @Inject(ZIBRI_DI_TOKENS.INSTANCE_ID)
        private readonly instanceId: string
    ) {}

    // read when used rather than injected, so that an application without the entity is told to
    // declare it by onAppInit, instead of failing on a repository token while this is built
    private get leaseRepository(): Repository<Lease, CreateLeaseData> {
        return inject(repositoryTokenFor(Lease));
    }

    private get wakeUpService(): WakeUpServiceInterface {
        return inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE);
    }

    /**
     * Fails the boot of an application that cannot coordinate.
     *
     * Every grant lives in one shared table, so an application without it has no way for two
     * replicas to agree on anything - and finding that out at the first contended request rather
     * than at startup is how a deployment discovers it in production.
     * @param app - The application being initialized.
     */
    onAppInit(app: ZibriApplication): void {
        validateEntitiesRegistered(LeaseService.name, app, Lease);
        // the name as well, since applications of different names can share the table
        this.holder = `${app.options.name}@${this.instanceId}`;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async withLease<T>(options: LeaseOptions, fn: (lost: AbortSignal) => Promise<T>): Promise<T | undefined> {
        const mode: LeaseAcquisitionMode = options.mode ?? 'skip';
        const taken: Lease | undefined = mode === 'wait'
            ? await this.acquireWaiting(options)
            : await this.tryAcquire(options);

        if (!taken) {
            return undefined;
        }
        return options.heldUntil != undefined && !options.heldUntil.isFinished
            ? await this.runHoldingUntil(taken, options, options.heldUntil, fn)
            : await this.runHolding([taken], options, options.key, fn);
    }

    /**
     * Runs the work under a grant that has already been taken, and hands it back once the work has
     * returned and the transaction it writes in has ended.
     * @param taken - The grant that was acquired.
     * @param options - How long it lives and what happens to it afterwards.
     * @param transaction - The transaction the work writes in, still open.
     * @param fn - The work to run.
     * @returns Whatever the work returned.
     */
    private async runHoldingUntil<T>(
        taken: Lease,
        options: LeaseOptions,
        transaction: RepositoryTransaction,
        fn: (lost: AbortSignal) => Promise<T>
    ): Promise<T> {
        let workOutcome: LeaseWorkOutcome = 'unfinished';
        let committed: boolean | undefined = undefined;
        // the work is only done once the transaction has landed it, so a rollback counts as having
        // thrown, and the shutdown drain giving up before both have ended finds it unfinished
        const grant: KeptGrant = this.keepAlive(
            this.heldLeaseFor([taken], options, options.key, () => {
                if (workOutcome === 'unfinished' || committed == undefined) {
                    return 'unfinished';
                }
                return committed ? workOutcome : 'threw';
            }),
            options.leaseInMs
        );
        // by whichever of the two ends last: the caller usually ends the transaction after the work has
        // returned, but the work may end it itself
        const releaseOnceBothEnded: () => Promise<void> = async () => {
            if (workOutcome !== 'unfinished' && committed != undefined) {
                await grant.release();
            }
        };
        transaction.afterFinish(async hasCommitted => {
            committed = hasCommitted;
            try {
                await releaseOnceBothEnded();
            }
            catch (error) {
                // the transaction has ended either way, and its caller is not the one to tell
                this.logger.warn(
                    `Could not release "${options.key}" once its transaction ended: ${error instanceof Error ? error.message : error}`
                );
            }
        });

        try {
            // the transaction the grant is held until is the one write that does land inside it
            const result: T = await runInLeaseScope(options.key, async () => await fn(grant.lost), transaction);
            workOutcome = 'completed';
            return result;
        }
        catch (error) {
            workOutcome = 'threw';
            throw error;
        }
        finally {
            await releaseOnceBothEnded();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async withLeases<T>(
        keys: string[],
        options: LeaseSetOptions,
        fn: (taken: string[], lost: AbortSignal) => Promise<T>
    ): Promise<T | undefined> {
        // in parallel, because the keys are independent and nothing orders them. Whichever are
        // already held simply come back undefined - this is 'skip' by construction, and there is no
        // 'wait' form on purpose: queueing for several keys at once is how two callers wanting the
        // same two keys in different orders wait for each other forever.
        const results: (Lease | undefined)[] = await Promise.all(
            keys.map(async key => await this.tryAcquire({ ...options, key }))
        );
        const taken: Lease[] = results.filter((l): l is Lease => l != undefined);

        return !taken.length
            ? undefined
            : await this.runHolding(taken, options, this.nameFor(taken), async lost => await fn(taken.map(l => l.key), lost));
    }

    /**
     * Runs the work under grants that have already been taken, and applies the completion to them.
     *
     * Shared by both entry points, so a batch behaves exactly like a single grant in every way
     * except how many rows it writes.
     * @param taken - The grants that were acquired.
     * @param options - How long they live and what happens to them afterwards.
     * @param name - Names them for logs and warnings.
     * @param fn - The work to run.
     * @returns Whatever the work returned.
     */
    private async runHolding<T>(
        taken: Lease[],
        options: LeaseSetOptions,
        name: string,
        fn: (lost: AbortSignal) => Promise<T>
    ): Promise<T> {
        // read by the release, which runs inside hold's finally - so it has to be set before the
        // work's rejection escapes, not in a catch wrapped around hold. It stays 'unfinished' for as
        // long as the work is running, which is what the shutdown drain sees when it gives up on it.
        let outcome: LeaseWorkOutcome = 'unfinished';
        const body: (lost: AbortSignal) => Promise<T> = async lost => {
            try {
                const result: T = await fn(lost);
                outcome = 'completed';
                return result;
            }
            catch (error) {
                outcome = 'threw';
                throw error;
            }
        };

        return await this.hold(
            this.heldLeaseFor(taken, options, name, () => outcome),
            options.leaseInMs,
            // wrapped rather than called directly, so a write that only lands on a commit the grant
            // will not be held for is reported - see runInLeaseScope, and 10.4 for what it costs
            // when it is not noticed
            async lost => await runInLeaseScope(name, async () => await body(lost))
        );
    }

    /**
     * Names a set of grants for logs and warnings.
     * @param taken - The grants that were acquired.
     * @returns The key when there is one, otherwise a bounded summary - a batch can be large enough
     * that joining every key turns one warning into a wall of text.
     */
    private nameFor(taken: Lease[]): string {
        const [first, ...rest] = taken;
        return rest.length ? `${first?.key} +${rest.length} more` : `${first?.key}`;
    }

    /**
     * Takes the grant, or reports that somebody else has it.
     *
     * The insert is the decision. Its key is unique, so the data source picks the winner and no
     * amount of concurrency changes the outcome - unlike a read of "is it free" followed by a write,
     * which is the shape this whole area exists to avoid.
     * @param options - What to take.
     * @returns The grant, or undefined when another instance holds it.
     */
    private async tryAcquire(options: LeaseOptions): Promise<Lease | undefined> {
        // an instance that died holding this never handed it back. Clearing the lapsed one first is
        // what makes a crashed replica recoverable rather than permanently blocking.
        // Expiry is written and judged by the clock of the data source, which every instance shares.
        // Judged by each instance's own, an instance whose clock ran ahead by more than a lease took
        // over work that was still running.
        await this.leaseRepository.deleteAll({ key: options.key, expiresAt: { before: dataSourceNow() } });

        try {
            return await this.leaseRepository.create({
                key: options.key,
                expiresAt: dataSourceNow(options.leaseInMs),
                heldBy: this.holder
            });
        }
        catch {
            // the unique key refused the insert, so somebody else holds it. That is the expected
            // outcome on every instance but one and is not worth a log line.
            return undefined;
        }
    }

    /**
     * Keeps trying until the grant is free, or until waiting for it stops being reasonable.
     * @param options - What to take.
     * @returns The grant.
     * @throws When the wait ran out. A caller that asked to queue cannot be told "never mind" and
     * left to carry on as though the work had been done.
     */
    private async acquireWaiting(options: LeaseOptions): Promise<Lease> {
        const waitInMs: number = options.acquireTimeoutInMs ?? options.leaseInMs;
        const deadline: number = Date.now() + waitInMs;
        // a request that has already been answered is not queueing for anything. Without this the
        // wait runs to its own limit, contending for a grant it would take and hand straight back
        const signal: AbortSignal | undefined = AlsUtilities.findCurrentRequestSignal();

        const dataSource: DataSourceInterface = this.leaseRepository.dataSource;
        // before the first try, so a release between the try and the wait is not missed
        const released: WakeUpListener = await this.wakeUpService.listen(dataSource, WAKE_UP_TOPICS.leaseReleased(options.key));
        const intervalInMs: number = this.wakeUpService.reachesOtherInstances(dataSource)
            ? ACQUIRE_FALLBACK_INTERVAL_IN_MS
            : ACQUIRE_RETRY_INTERVAL_IN_MS;
        try {
            for (;;) {
                if (signal?.aborted === true) {
                    throw signal.reason;
                }
                const taken: Lease | undefined = await this.tryAcquire(options);
                if (taken) {
                    return taken;
                }
                if (Date.now() >= deadline) {
                    throw new LeaseAcquisitionTimeoutError(options.key, waitInMs);
                }
                await released.next(Math.min(intervalInMs, deadline - Date.now()), signal);
            }
        }
        finally {
            released.stop();
        }
    }

    /**
     * Wraps taken grants in the three operations holding them needs.
     * @param leases - The rows that were taken.
     * @param options - How long they live, and what should happen to them afterwards.
     * @param name - Names them for logs and warnings.
     * @param outcome - How the work ended. Read at release time rather than passed as a value,
     * because the answer is not known when this is built - and the shutdown drain can release a
     * grant while the work is still running, which is an answer of its own.
     * @returns The grant, ready to be held.
     */
    private heldLeaseFor(
        leases: Lease[],
        options: LeaseSetOptions,
        name: string,
        outcome: () => LeaseWorkOutcome
    ): HeldLease {
        // by id rather than by key throughout, so a holder whose grant lapsed and was taken over
        // cannot renew or free its successor's - which is what turned one lost exclusion into a
        // permanent one in 10.1
        const ids: string[] = leases.map(l => l.id);

        return {
            name,
            renew: async () => {
                const renewed: number = await this.leaseRepository.updateAll(
                    { id: { oneOf: ids } },
                    { expiresAt: dataSourceNow(options.leaseInMs) }
                );
                // a row that is gone is one this instance no longer holds. Throwing is what makes
                // that reach a log line and the work at all: a grant lost silently let a slow
                // subscriber run again on another replica while it was still working.
                if (renewed !== ids.length) {
                    throw new LeaseLostError(
                        name,
                        new InternalError(`held ${ids.length} leases but only ${renewed} could be renewed`)
                    );
                }
            },
            release: async () => {
                if (this.retains(options, outcome())) {
                    return;
                }
                await this.leaseRepository.deleteAll({ id: { oneOf: ids } });
                // whoever queues for the key takes it now rather than at its next try. One grant
                // only: a batch is taken without queueing, and its keys are items nobody queues for
                const [only, ...more] = leases;
                if (only != undefined && !more.length) {
                    await this.wakeUpService.wake(this.leaseRepository.dataSource, WAKE_UP_TOPICS.leaseReleased(only.key));
                }
            }
        };
    }

    /**
     * Decides whether the grants are kept rather than handed back.
     * @param options - What was asked for.
     * @param outcome - How the work ended.
     * @returns Whether to keep them until they lapse on their own.
     */
    private retains(options: LeaseSetOptions, outcome: LeaseWorkOutcome): boolean {
        // work that never ended cannot have a grant kept on its behalf, whatever was asked for.
        // Retaining is a statement that the work has been done, and the only way to get here with
        // the work still running is the shutdown drain giving up on it - at which point handing it
        // over beats making the next replica sit out a full lease for work that stopped.
        if (outcome === 'unfinished') {
            return false;
        }

        switch (options.onCompletion ?? 'release') {
            // a retained grant is also the record that this work has already been done, so nothing
            // hands it back once it has. It lapses on its own expiresAt, which is what bounds how
            // long that memory lasts.
            case 'retain': {
                return true;
            }
            case 'retainOnError': {
                return outcome === 'threw';
            }
            case 'release': {
                return false;
            }
        }
    }

    /**
     * Runs the work while keeping its grant alive, and hands the grant back afterwards.
     *
     * The release runs whatever the work did, including throwing - a grant that outlives the work it
     * protected is the failure this whole class exists to prevent.
     * @param lease - The grant that was taken.
     * @param leaseInMs - How long it lives, so renewal can sit well inside that.
     * @param fn - The work to run under it.
     * @returns Whatever the work returned.
     */
    async hold<T>(lease: HeldLease, leaseInMs: number, fn: (lost: AbortSignal) => Promise<T>): Promise<T> {
        return await this.holdWith(lease, leaseInMs, new AbortController(), fn);
    }

    /**
     * Runs the work while keeping a taken grant alive, telling it through the given controller when
     * the grant is lost.
     * @param lease - The grant that was taken.
     * @param leaseInMs - How long it lives, so renewal can sit well inside that.
     * @param loss - Aborted once the grant is lost. The caller's, so it can be read before the work
     * is in a callback to be handed it.
     * @param fn - The work to run under it.
     * @returns Whatever the work returned.
     */
    private async holdWith<T>(
        lease: HeldLease,
        leaseInMs: number,
        loss: AbortController,
        fn: (lost: AbortSignal) => Promise<T>
    ): Promise<T> {
        const work: Promise<T> = this.runRenewed(lease, leaseInMs, loss, fn);
        // tracked before it is awaited, so a shutdown starting mid work still knows about it
        this.inFlight.set(lease, work);

        try {
            return await work;
        }
        finally {
            this.inFlight.delete(lease);
            await lease.release();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    keepAlive(lease: HeldLease, leaseInMs: number): KeptGrant {
        let stop: () => void = () => {};
        const until: Promise<void> = new Promise<void>(resolve => {
            stop = resolve;
        });

        // deliberately not awaited. This is `hold` with the work replaced by "until somebody says
        // stop", which means renewal, the shutdown drain and the release in its finally all apply
        // unchanged - a grant with no callback around it is the only thing that is new here.
        const loss: AbortController = new AbortController();
        const held: Promise<void> = this.holdWith(lease, leaseInMs, loss, async () => await until);

        let released: Promise<void> | undefined = undefined;
        return {
            lost: loss.signal,
            release: async () => {
                // the promise rather than a boolean, so two callers racing to release both wait for
                // the same one to finish rather than one returning while the grant is still going
                released ??= (async () => {
                    stop();
                    await held;
                })();
                await released;
            }
        };
    }

    /**
     * Lets the work that is running finish, then frees whatever is still held.
     *
     * The order matters. Releasing everything up front would hand work that is still running to
     * another replica and produce exactly the duplicate this is all meant to stop, so the grants
     * that are still doing something are waited for first - they release themselves as they finish,
     * and the data sources are still connected because they close in afterAppShutdown.
     *
     * Only what is still held once that wait runs out gets taken away, and by then the process is
     * going to die with the work unfinished either way. At that point an immediate takeover beats
     * making the next replica sit out a full lease.
     *
     * Nothing here has to stop new work from being taken: the http server is drained before any of
     * the shutdown hooks run, and the cron service stops its jobs in beforeAppShutdown, so by this
     * point there is nothing left that could ask for a grant.
     */
    async onAppShutdown(): Promise<void> {
        if (!this.inFlight.size) {
            return;
        }
        this.logger.info(`waits for ${this.inFlight.size} held leases to finish`);

        // settled rather than all: work that throws still released its grant on the way out, which
        // is all this wait is about. The error itself is the caller's to report.
        const drained: boolean = await this.drain();
        if (drained) {
            return;
        }

        this.logger.warn(
            `${this.inFlight.size} leases were still held after ${this.drainTimeoutInMs}ms`
            + ' - releasing them so another instance can take the work over'
        );
        await Promise.all([...this.inFlight.keys()].map(async lease => await this.forceRelease(lease)));
    }

    /**
     * Waits for the work that is currently holding a grant.
     * @returns True when everything finished, false when the wait ran out first.
     */
    private async drain(): Promise<boolean> {
        try {
            await PromiseUtilities.withTimeout(
                async () => await Promise.allSettled(this.inFlight.values()),
                this.drainTimeoutInMs
            );
            return true;
        }
        catch {
            return false;
        }
    }

    /**
     * Runs the work with a timer extending its grant underneath it.
     *
     * Losing the grant is told to the work and never acted on here: stopping halfway would leave
     * whatever the work had already written behind, which is not obviously better than finishing,
     * and only the work knows whether whoever takes the grant over starts it again from scratch.
     * The release checks ownership anyway, so a lapsed holder cannot take its successor's grant away
     * on the way out.
     * @param lease - The grant to keep alive.
     * @param leaseInMs - How long it lives.
     * @param loss - Aborted once the grant is lost.
     * @param fn - The work to run.
     * @returns Whatever the work returned.
     */
    private async runRenewed<T>(
        lease: HeldLease,
        leaseInMs: number,
        loss: AbortController,
        fn: (lost: AbortSignal) => Promise<T>
    ): Promise<T> {
        // by this instance's clock, moved on by every renewal that landed. A renewal that failed
        // before this passes may be a slow round trip; one that failed after it is a grant anybody
        // may take now, whether or not the store comes back
        let heldUntil: number = Date.now() + leaseInMs;
        const renewal: NodeJS.Timeout = setInterval(
            () => void (async () => {
                // taken before the write rather than after, so a slow round trip counts against the
                // grant rather than for it
                const renewedAt: number = Date.now();
                try {
                    await lease.renew();
                    heldUntil = renewedAt + leaseInMs;
                }
                catch (error) {
                    this.reportLostRenewal(lease, error);
                    if (error instanceof LeaseLostError || Date.now() >= heldUntil) {
                        clearInterval(renewal);
                        // unlabelled: a grant's name carries the id of whatever it guards
                        inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
                            .getCounter('leases_lost_total')
                            .increase();
                        loss.abort(error instanceof LeaseLostError ? error : new LeaseLostError(lease.name, error));
                    }
                }
            })(),
            leaseInMs / RENEWALS_PER_LEASE
        );
        // so work in flight can never be the reason a process refuses to exit
        renewal.unref();

        try {
            return await fn(loss.signal);
        }
        finally {
            clearInterval(renewal);
        }
    }

    /**
     * Reports a renewal that failed, without letting it become the reason the work fails.
     *
     * Reported here rather than left to each `renew` implementation. A grant that has been lost
     * while its work carries on is the exact situation this service exists to make visible, and
     * relying on every implementation to say so itself is how it ends up said nowhere.
     * @param lease - The grant that could not be extended.
     * @param error - What the renewal failed with.
     */
    private reportLostRenewal(lease: HeldLease, error: unknown): void {
        inject(ZIBRI_DI_TOKENS.METRICS_SERVICE)
            .getCounter('lease_renewal_failures_total')
            .increase();
        this.logger.warn(
            `Could not renew "${lease.name}" while the work is still running: `
            + `${error instanceof Error ? error.message : error}`
        );
    }

    /**
     * Frees a grant whose work is not going to finish, without letting that stop the shutdown.
     * @param lease - The grant to free.
     */
    private async forceRelease(lease: HeldLease): Promise<void> {
        try {
            await lease.release();
        }
        catch (error) {
            this.logger.warn(
                `Could not release "${lease.name}" during shutdown: ${error instanceof Error ? error.message : error}`
            );
        }
    }
}