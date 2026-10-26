import { QueueDelivery } from './queue-delivery.type';
import { QueuedWorkItem } from './queued-work-item.model';
import { QueuedWorkOutcome } from './queued-work-outcome.model';
import { QueuedWorkRun } from './queued-work-run.model';
import { DataSourceInterface } from '../data-source/data-sources/data-source.interface';
import { Transaction } from '../data-source/transaction/transaction.model';
import { LeaseCompletion } from '../leases/lease-options.model';

/**
 * A queue of work rows, as one subsystem keeps it: which rows are due, how one is run, and how its
 * outcome is written. Claiming, counting attempts, backing off and the delivery are the same for
 * every queue.
 */
export type QueueDefinition<T extends QueuedWorkItem> = {
    /**
     * Names the queue in claim keys and messages, such as `email`.
     */
    name: string,
    /**
     * The topic a retry falling due wakes the poll of the queue with.
     */
    wakeUpTopic: string,
    /**
     * The data source the rows are kept in, which a `'transactional'` attempt runs in.
     */
    dataSource: DataSourceInterface,
    /**
     * How long a claim lasts without being renewed, which is how long work an instance left behind
     * waits before another takes it over.
     */
    leaseInMs: number,
    /**
     * What becomes of a claim once its attempt is over, see `LeaseOptions.onCompletion`.
     */
    onCompletion: LeaseCompletion,
    /**
     * `'item'` claims and runs each row on its own, `'batch'` claims the rows of a poll together and
     * runs them in `runBatch`.
     */
    claimedPer: 'item' | 'batch',
    /**
     * How long the first retry waits, doubling for each one after it.
     */
    firstRetryDelayInMs: number,
    /**
     * Finds the rows that are due, the ones to run first first. For a queue `poll` runs; one whose
     * rows are handed to `runClaimed` leaves it out.
     * @returns The rows.
     */
    findDue?: () => Promise<T[]>,
    /**
     * Reads a row again once its claim is taken, for a queue whose rows were read before, such as on a
     * page another instance may have recorded an attempt of since.
     * @returns The row as it is now.
     */
    refresh?: (item: T) => Promise<T>,
    /**
     * Names a row the same on every attempt, such as its id.
     */
    findRunId: (item: T) => string,
    /**
     * How many attempts a row gets in all.
     */
    findMaxAttempts: (item: T) => number,
    /**
     * How a row is delivered, `'atLeastOnce'` unless the queue says otherwise.
     */
    findDelivery?: (item: T) => QueueDelivery,
    /**
     * Runs the work of one row.
     */
    run: (item: T, run: QueuedWorkRun) => Promise<void>,
    /**
     * Runs the rows of a poll claimed together, each through the given function. With
     * `claimedPer: 'batch'`, such as to count them against a rate limit at once.
     * @returns False when none of them could run now, which keeps their claims from holding them up.
     */
    runBatch?: (items: T[], runEach: (item: T) => Promise<void>) => Promise<boolean>,
    /**
     * Writes how an attempt ended: the outcome's columns, and whatever else the queue keeps, such as
     * its status.
     */
    record: (item: T, outcome: QueuedWorkOutcome, transaction: Transaction | undefined) => Promise<void>,
    /**
     * The error logged when a row gives up, the outcome's cause by default.
     */
    resolveGiveUpError?: (item: T, cause: Error) => Error
};
