import { SpanningTransactionParticipants } from './spanning-transaction-participants.model';
import { StartTransactionOptions } from '../data-sources/data-source.interface';

/**
 * A transaction across every data source its writes reach, which repositories take wherever they
 * take a transaction.
 *
 * Each data source gets a transaction of its own, started with the options given here when a
 * repository of it first reads or writes through this one. A commit commits them one after the other:
 * the ones reached after the first in the order they were reached, and the first one last. When one of
 * them fails, its writes are undone everywhere: the data sources that had not committed yet are rolled
 * back, the ones that had are restored to the rows they held before, and the commit throws a
 * `SpanningTransactionCommitError`.
 *
 * Work added with `afterCommit` runs once every data source has committed, and never when the writes
 * were undone.
 */
export class SpanningTransaction {
    /**
     * What tells it apart from the transaction of one data source.
     */
    readonly spansDataSources: true = true;

    private readonly participants: SpanningTransactionParticipants;

    /**
     * Builds a transaction that has not reached any data source yet.
     * @param options - What the transaction of each data source is started with.
     */
    constructor(options: StartTransactionOptions = {}) {
        this.participants = new SpanningTransactionParticipants(options);
        SpanningTransactionParticipants.register(this, this.participants);
    }

    /**
     * Whether the transaction has already been committed or rolled back.
     * @returns True once it has.
     */
    get isFinished(): boolean {
        return this.participants.isFinished;
    }

    /**
     * Commits the transaction in every data source it reached.
     * @throws SpanningTransactionCommitError when one of them failed to commit, once the writes are
     * undone everywhere.
     */
    async commit(): Promise<void> {
        await this.participants.commit();
    }

    /**
     * Rolls back the transaction in every data source it reached.
     */
    async rollback(): Promise<void> {
        await this.participants.rollback();
    }

    /**
     * Runs work once the transaction committed in every data source, and never when it is rolled back
     * or its writes were undone.
     * @param work - The work. It handles its own failures, since the commit has happened either way.
     */
    afterCommit(work: () => Promise<void>): void {
        this.participants.afterCommit(work);
    }

    /**
     * Runs work once the transaction has ended, told whether it committed in every data source.
     * @param work - The work. It handles its own failures.
     */
    afterFinish(work: (committed: boolean) => Promise<void>): void {
        this.participants.afterFinish(work);
    }
}
