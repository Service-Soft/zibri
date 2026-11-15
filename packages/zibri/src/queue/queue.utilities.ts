import { QueueDefinition } from './queue-definition.model';
import { QueueDelivery } from './queue-delivery.type';
import { QueuedWorkHandedBackError } from './queued-work-handed-back.error';
import { QueuedWorkItem } from './queued-work-item.model';
import { QueuedWorkOutcome } from './queued-work-outcome.model';
import { type RepositoryTransaction } from '../data-source/transaction/repository-transaction.type';
import { SpanningTransaction } from '../data-source/transaction/spanning-transaction.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { type LeaseServiceInterface } from '../leases/lease-service.interface';
import { errorToLoggedError } from '../logging/error-to-logged-error.function';
import { type LoggerInterface } from '../logging/logger.interface';

/**
 * How many rows of each queue with a `maxConcurrentPerInstance` this process runs right now, by the
 * queue's name.
 *
 * By name rather than on the definition, since a subsystem builds its definition anew for each poll,
 * and in the process rather than per application, since what it bounds is this instance's memory,
 * disk and connections, which one process holds.
 */
const running: Map<string, number> = new Map();

/**
 * How a claim on a row went: somebody else held it, its attempt was written down, or it ran without
 * being written down - handed back, or with the claim lost while it ran.
 */
type ClaimedAttempt = 'notClaimed' | 'recorded' | 'notRecorded';

/**
 * Runs the rows of a queue: claims each due one, runs it, and records how the attempt ended, counting
 * attempts, backing off and giving up the same way for every queue.
 */
export abstract class QueueUtilities {
    /**
     * Runs the rows of a queue that are due now, as many at once as its `maxConcurrentPerInstance`
     * allows beside those this instance runs already.
     * @param queue - The queue.
     * @returns Whether any row was run. One that was is a reason to look again soon.
     */
    static async poll<T extends QueuedWorkItem>(queue: QueueDefinition<T>): Promise<boolean> {
        // asked before reading the rows too, so an instance with every slot taken does not query for them
        if (this.resolveFreeSlots(queue) <= 0) {
            return false;
        }
        const due: T[] = await queue.findDue?.() ?? [];
        // asked again after the read: another poll may have taken slots meanwhile. From here to taking
        // them nothing is awaited, so no poll takes the same ones
        const free: number = this.resolveFreeSlots(queue);
        if (!due.length || free <= 0) {
            return false;
        }
        if (queue.claimedPer === 'batch') {
            const batch: T[] = due.slice(0, free);
            return await this.inSlots(queue, batch.length, async () => await this.runClaimedBatch(queue, batch));
        }
        // a slot whose row another instance holds goes on to the next one, so a row held elsewhere
        // takes no slot; only what is claimed here is, and the rest stays due for others
        const candidates: T[] = [...due];
        const slots: Promise<boolean>[] = Array.from(
            { length: Math.min(free, due.length) },
            async () => await this.inSlots(queue, 1, async () => queue.maxConcurrentPerInstance == undefined
                ? await this.runNextClaimed(queue, candidates) !== 'notClaimed'
                : await this.runSlot(queue, candidates))
        );
        return (await Promise.all(slots)).some(Boolean);
    }

    /**
     * Runs rows in one slot of a limited queue until none is left that nobody else holds.
     *
     * A slot that is done goes on with the rows it left for lack of a slot, rather than leaving them
     * to the next poll: the poll that queued them may be the only one coming, as when a backup is
     * queued, and a scheduled one may be half a minute away.
     * @param queue - The queue.
     * @param candidates - The rows still to try, shared with the poll's other slots.
     * @returns Whether a row ran.
     */
    private static async runSlot<T extends QueuedWorkItem>(queue: QueueDefinition<T>, candidates: T[]): Promise<boolean> {
        let ranAny: boolean = false;
        for (let attempted: ClaimedAttempt = await this.runNextClaimed(queue, candidates); attempted !== 'notClaimed';) {
            ranAny = true;
            // only past an attempt that was written down: a row handed back, as an application that
            // stops hands back what it ran, or one whose claim was lost, is due again at once, and
            // going on would claim it again for as long as the reason lasts
            if (attempted === 'notRecorded') {
                break;
            }
            // read again rather than taken from the list: another instance may have run one since.
            // One running in another slot is held, and passed over
            candidates.splice(0, candidates.length, ...await queue.findDue?.() ?? []);
            attempted = await this.runNextClaimed(queue, candidates);
        }
        return ranAny;
    }

    /**
     * Claims one row, and runs it when the claim is taken. For a queue whose rows are handed to it
     * one at a time rather than found by `poll`, such as an event and one of its subscribers.
     * @param queue - The queue.
     * @param item - The row.
     * @returns Whether it ran, false when somebody else holds it.
     */
    static async runClaimed<T extends QueuedWorkItem>(queue: QueueDefinition<T>, item: T): Promise<boolean> {
        return await this.runClaimedAttempt(queue, item) !== 'notClaimed';
    }

    /**
     * Claims one row, runs it when the claim is taken, and answers how that went.
     * @param queue - The queue.
     * @param item - The row.
     * @returns `'notClaimed'` when somebody else holds it, `'recorded'` when its attempt was written
     * down, and `'notRecorded'` when it was handed back or the claim was lost while it ran.
     */
    private static async runClaimedAttempt<T extends QueuedWorkItem>(queue: QueueDefinition<T>, item: T): Promise<ClaimedAttempt> {
        const attempted: ClaimedAttempt | undefined = await this.leaseService.withLease(
            { key: this.resolveClaimKey(queue, item), leaseInMs: queue.leaseInMs, onCompletion: queue.onCompletion },
            async lost => await this.attempt(queue, item, lost) ? 'recorded' : 'notRecorded'
        );
        return attempted ?? 'notClaimed';
    }

    /**
     * Resolves how many more rows of a queue this instance may run now.
     * @param queue - The queue.
     * @returns The number, infinite for a queue without a limit.
     */
    private static resolveFreeSlots<T extends QueuedWorkItem>(queue: QueueDefinition<T>): number {
        return queue.maxConcurrentPerInstance == undefined
            ? Number.POSITIVE_INFINITY
            : queue.maxConcurrentPerInstance - (running.get(queue.name) ?? 0);
    }

    /**
     * Runs work counted as the given number of the queue's rows running on this instance until it is
     * done.
     * @param queue - The queue.
     * @param count - How many rows the work runs.
     * @param work - The work.
     * @returns What the work returned.
     */
    private static async inSlots<T extends QueuedWorkItem, R>(
        queue: QueueDefinition<T>,
        count: number,
        work: () => Promise<R>
    ): Promise<R> {
        if (queue.maxConcurrentPerInstance == undefined) {
            return await work();
        }
        // taken before the first await, so polls that overlap never count the same slot as free
        running.set(queue.name, (running.get(queue.name) ?? 0) + count);
        try {
            return await work();
        }
        finally {
            const left: number = (running.get(queue.name) ?? count) - count;
            if (left > 0) {
                running.set(queue.name, left);
            }
            else {
                running.delete(queue.name);
            }
        }
    }

    /**
     * Claims and runs the next of the given rows that nobody else holds.
     * @param queue - The queue.
     * @param candidates - The rows still to try, which this takes from.
     * @returns How the attempt went, `'notClaimed'` when every row is held elsewhere.
     */
    private static async runNextClaimed<T extends QueuedWorkItem>(queue: QueueDefinition<T>, candidates: T[]): Promise<ClaimedAttempt> {
        for (let item: T | undefined = candidates.shift(); item != undefined; item = candidates.shift()) {
            const attempted: ClaimedAttempt = await this.runClaimedAttempt(queue, item);
            if (attempted !== 'notClaimed') {
                return attempted;
            }
        }
        return 'notClaimed';
    }

    /**
     * Claims the rows of a poll together, and runs those taken through the queue's batch.
     * @param queue - The queue.
     * @param due - The rows.
     * @returns Whether they ran.
     */
    private static async runClaimedBatch<T extends QueuedWorkItem>(queue: QueueDefinition<T>, due: T[]): Promise<boolean> {
        const byKey: Map<string, T> = new Map(due.map(item => [this.resolveClaimKey(queue, item), item]));
        const ran: boolean | undefined = await this.leaseService.withLeases(
            [...byKey.keys()],
            { leaseInMs: queue.leaseInMs, onCompletion: queue.onCompletion },
            async (taken, lost) => {
                const items: T[] = taken.flatMap(key => byKey.get(key) ?? []);
                const runEach: (item: T) => Promise<void> = async item => {
                    await this.attempt(queue, item, lost);
                };
                if (queue.runBatch == undefined) {
                    await Promise.all(items.map(runEach));
                    return true;
                }
                return await queue.runBatch(items, runEach);
            }
        );
        // undefined when somebody else holds every one of them: answering true would poll the same
        // rows again at once and fail to claim them again
        return ran ?? false;
    }

    /**
     * Runs one attempt at a claimed row the way it is delivered, and records how it ended.
     * @param queue - The queue.
     * @param claimed - The row.
     * @param lost - Fires when the claim is lost.
     * @returns Whether the attempt was written down, false when it was handed back or the claim was lost.
     */
    private static async attempt<T extends QueuedWorkItem>(queue: QueueDefinition<T>, claimed: T, lost: AbortSignal): Promise<boolean> {
        // read again under the claim when the queue asks to, since an attempt recorded elsewhere
        // since the row was read is one this one has to count after
        const item: T = await queue.refresh?.(claimed) ?? claimed;
        const attempts: number = item.attempts + 1;
        const delivery: QueueDelivery = queue.findDelivery?.(item) ?? 'atLeastOnce';
        const runId: string = queue.findRunId(item);
        if (delivery === 'atMostOnce') {
            // written down as failed before it runs, so an instance stopping during it leaves it
            // failed rather than run again
            await queue.record(
                item,
                this.resolveFailure(queue, item, attempts, new InternalError('The attempt stopped before it finished'), false),
                undefined
            );
        }
        if (delivery === 'transactional') {
            return await this.attemptInTransaction(queue, item, attempts, runId, lost);
        }
        let failure: Error | undefined;
        try {
            await queue.run(item, { runId, attempt: attempts, signal: lost, transaction: undefined });
        }
        catch (error) {
            failure = this.toError(error);
        }
        // whoever took the claim over runs it again and records that attempt; recording this one
        // beside it would say the attempt ended twice
        if (lost.aborted) {
            this.logger.warn(`Lost the claim on ${queue.name} ${runId} while it ran, so its attempt is not recorded`);
            return false;
        }
        if (failure instanceof QueuedWorkHandedBackError) {
            this.logger.info(`Handed ${queue.name} ${runId} back without recording its attempt: ${failure.message}`);
            return false;
        }
        await this.recordAttempt(queue, item, attempts, failure, delivery === 'atLeastOnce', undefined);
        return true;
    }

    /**
     * Runs one attempt in a transaction that records it as well, so the writes of a successful one
     * and its record are committed together, and those of a failed one rolled back.
     * @param queue - The queue.
     * @param item - The row.
     * @param attempts - How many attempts this one makes.
     * @param runId - Names the row on every attempt.
     * @param lost - Fires when the claim is lost.
     * @returns Whether the attempt was written down, false when it was handed back or the claim was lost.
     */
    private static async attemptInTransaction<T extends QueuedWorkItem>(
        queue: QueueDefinition<T>,
        item: T,
        attempts: number,
        runId: string,
        lost: AbortSignal
    ): Promise<boolean> {
        // spanning, since the run is the subsystem's or the application's, writing wherever it keeps
        // its rows
        const transaction: SpanningTransaction = new SpanningTransaction();
        try {
            await queue.run(item, { runId, attempt: attempts, signal: lost, transaction });
            if (lost.aborted) {
                await transaction.rollback();
                return false;
            }
            await this.recordAttempt(queue, item, attempts, undefined, true, transaction);
            await transaction.commit();
            return true;
        }
        catch (error) {
            await transaction.rollback();
            if (lost.aborted || error instanceof QueuedWorkHandedBackError) {
                return false;
            }
            await this.recordAttempt(queue, item, attempts, this.toError(error), true, undefined);
            return true;
        }
    }

    /**
     * Records how an attempt ended, logging one that failed.
     * @param queue - The queue.
     * @param item - The row.
     * @param attempts - How many attempts were spent, this one included.
     * @param failure - What the attempt failed with, undefined when it succeeded.
     * @param mayRetry - Whether a failed attempt may be tried again.
     * @param transaction - The transaction to record it in, if any.
     */
    private static async recordAttempt<T extends QueuedWorkItem>(
        queue: QueueDefinition<T>,
        item: T,
        attempts: number,
        failure: Error | undefined,
        mayRetry: boolean,
        transaction: RepositoryTransaction | undefined
    ): Promise<void> {
        const outcome: QueuedWorkOutcome = failure == undefined
            ? { kind: 'succeeded', attempts, nextAttemptAt: null, error: null }
            : this.resolveFailure(queue, item, attempts, failure, mayRetry);
        await queue.record(item, outcome, transaction);
        if (outcome.nextAttemptAt != undefined) {
            this.logger.warn(
                // eslint-disable-next-line stylistic/max-len
                `Attempt ${attempts} at ${queue.name} ${queue.findRunId(item)} failed, retrying after ${outcome.nextAttemptAt.toISOString()}`
            );
            inject(ZIBRI_DI_TOKENS.WAKE_UP_SERVICE).wakeAt(queue.wakeUpTopic, outcome.nextAttemptAt);
        }
        else if (outcome.kind === 'failed' && failure != undefined) {
            this.logger.error(queue.resolveGiveUpError?.(item, failure) ?? new InternalError(
                `${queue.name} ${queue.findRunId(item)} failed after ${attempts} attempts`,
                { cause: failure }
            ));
        }
    }

    /**
     * Resolves how an attempt that failed ends: tried again after a delay doubling from the queue's
     * first one, or given up once the row has spent its attempts.
     * @param queue - The queue.
     * @param item - The row.
     * @param attempts - How many attempts were spent, this one included.
     * @param failure - What it failed with.
     * @param mayRetry - Whether it may be tried again at all.
     * @returns The outcome.
     */
    private static resolveFailure<T extends QueuedWorkItem>(
        queue: QueueDefinition<T>,
        item: T,
        attempts: number,
        failure: Error,
        mayRetry: boolean
    ): QueuedWorkOutcome {
        if (mayRetry && attempts < queue.findMaxAttempts(item)) {
            const nextAttemptAt: Date = new Date(Date.now() + (queue.firstRetryDelayInMs * (2 ** (attempts - 1))));
            return { kind: 'retrying', attempts, nextAttemptAt, error: errorToLoggedError(failure) };
        }
        return { kind: 'failed', attempts, nextAttemptAt: null, error: errorToLoggedError(failure) };
    }

    /**
     * Names the claim on a row, apart from every other grant the application takes.
     * @param queue - The queue.
     * @param item - The row.
     * @returns The lease key.
     */
    private static resolveClaimKey<T extends QueuedWorkItem>(queue: QueueDefinition<T>, item: T): string {
        return `${queue.name}:${queue.findRunId(item)}`;
    }

    /**
     * Turns what an attempt threw into an error.
     * @param thrown - What it threw.
     * @returns The error.
     */
    private static toError(thrown: unknown): Error {
        return thrown instanceof Error ? thrown : new InternalError(String(thrown));
    }

    private static get leaseService(): LeaseServiceInterface {
        return inject(ZIBRI_DI_TOKENS.LEASE_SERVICE);
    }

    private static get logger(): LoggerInterface {
        return inject(ZIBRI_DI_TOKENS.LOGGER);
    }
}