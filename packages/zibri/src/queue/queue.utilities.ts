import { QueueDefinition } from './queue-definition.model';
import { QueueDelivery } from './queue-delivery.type';
import { QueuedWorkHandedBackError } from './queued-work-handed-back.error';
import { QueuedWorkItem } from './queued-work-item.model';
import { QueuedWorkOutcome } from './queued-work-outcome.model';
import { Transaction } from '../data-source/transaction/transaction.model';
import { ZIBRI_DI_TOKENS } from '../di/default/zibri-di-tokens.default';
import { inject } from '../di/inject.function';
import { InternalError } from '../error-handling/internal-error.model';
import { type LeaseServiceInterface } from '../leases/lease-service.interface';
import { errorToLoggedError } from '../logging/error-to-logged-error.function';
import { type LoggerInterface } from '../logging/logger.interface';

/**
 * Runs the rows of a queue: claims each due one, runs it, and records how the attempt ended, counting
 * attempts, backing off and giving up the same way for every queue.
 */
export abstract class QueueUtilities {
    /**
     * Runs the rows of a queue that are due now.
     * @param queue - The queue.
     * @returns Whether any row was run. One that was is a reason to look again soon.
     */
    static async poll<T extends QueuedWorkItem>(queue: QueueDefinition<T>): Promise<boolean> {
        const due: T[] = await queue.findDue?.() ?? [];
        if (!due.length) {
            return false;
        }
        return queue.claimedPer === 'batch'
            ? await this.runClaimedBatch(queue, due)
            : (await Promise.all(due.map(async item => await this.runClaimed(queue, item)))).some(Boolean);
    }

    /**
     * Claims one row, and runs it when the claim is taken. For a queue whose rows are handed to it
     * one at a time rather than found by `poll`, such as an event and one of its subscribers.
     * @param queue - The queue.
     * @param item - The row.
     * @returns Whether it ran, false when somebody else holds it.
     */
    static async runClaimed<T extends QueuedWorkItem>(queue: QueueDefinition<T>, item: T): Promise<boolean> {
        const ran: boolean | undefined = await this.leaseService.withLease(
            { key: this.resolveClaimKey(queue, item), leaseInMs: queue.leaseInMs, onCompletion: queue.onCompletion },
            async lost => {
                await this.attempt(queue, item, lost);
                return true;
            }
        );
        return ran ?? false;
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
                const runEach: (item: T) => Promise<void> = async item => await this.attempt(queue, item, lost);
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
     * @param item - The row.
     * @param lost - Fires when the claim is lost.
     */
    private static async attempt<T extends QueuedWorkItem>(queue: QueueDefinition<T>, claimed: T, lost: AbortSignal): Promise<void> {
        // read again under the claim when the queue asks to, since an attempt recorded elsewhere
        // since the row was read is one this one has to count after
        const item: T = await queue.refresh?.(claimed) ?? claimed;
        const attempts: number = item.attempts + 1;
        const delivery: QueueDelivery = queue.findDelivery?.(item) ?? 'atLeastOnce';
        const runId: string = queue.findRunId(item);
        if (delivery === 'atMostOnce') {
            // written down as failed before it runs, so an instance stopping during it leaves it
            // failed rather than run again
            await queue.record(item, this.resolveFailure(queue, item, attempts, new InternalError('The attempt stopped before it finished'), false), undefined);
        }
        if (delivery === 'transactional') {
            await this.attemptInTransaction(queue, item, attempts, runId, lost);
            return;
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
            return;
        }
        if (failure instanceof QueuedWorkHandedBackError) {
            this.logger.info(`Handed ${queue.name} ${runId} back without recording its attempt: ${failure.message}`);
            return;
        }
        await this.recordAttempt(queue, item, attempts, failure, delivery === 'atLeastOnce', undefined);
    }

    /**
     * Runs one attempt in a transaction that records it as well, so the writes of a successful one
     * and its record are committed together, and those of a failed one rolled back.
     * @param queue - The queue.
     * @param item - The row.
     * @param attempts - How many attempts this one makes.
     * @param runId - Names the row on every attempt.
     * @param lost - Fires when the claim is lost.
     */
    private static async attemptInTransaction<T extends QueuedWorkItem>(
        queue: QueueDefinition<T>,
        item: T,
        attempts: number,
        runId: string,
        lost: AbortSignal
    ): Promise<void> {
        const transaction: Transaction = await queue.dataSource.startTransaction();
        try {
            await queue.run(item, { runId, attempt: attempts, signal: lost, transaction });
            if (lost.aborted) {
                await transaction.rollback();
                return;
            }
            await this.recordAttempt(queue, item, attempts, undefined, true, transaction);
            await transaction.commit();
        }
        catch (error) {
            await transaction.rollback();
            if (!lost.aborted && !(error instanceof QueuedWorkHandedBackError)) {
                await this.recordAttempt(queue, item, attempts, this.toError(error), true, undefined);
            }
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
        transaction: Transaction | undefined
    ): Promise<void> {
        const outcome: QueuedWorkOutcome = failure == undefined
            // eslint-disable-next-line unicorn/no-null
            ? { kind: 'succeeded', attempts, nextAttemptAt: null, error: null }
            : this.resolveFailure(queue, item, attempts, failure, mayRetry);
        await queue.record(item, outcome, transaction);
        if (outcome.nextAttemptAt != undefined) {
            this.logger.warn(`Attempt ${attempts} at ${queue.name} ${queue.findRunId(item)} failed, retrying after ${outcome.nextAttemptAt.toISOString()}`);
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
        // eslint-disable-next-line unicorn/no-null
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
