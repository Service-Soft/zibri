import { SpanningTransactionCommitError } from './spanning-transaction-commit.error';
import { SpanningTransactionRestoreFailure } from './spanning-transaction-restore-failure.model';
import { type SpanningTransaction } from './spanning-transaction.model';
import { TransactionAlreadyFinishedError } from './transaction-already-finished.error';
import { Transaction } from './transaction.model';
import { InternalError } from '../../error-handling/internal-error.model';
import { type DataSourceInterface, StartTransactionOptions } from '../data-sources/data-source.interface';

/**
 * Undoes one write of a spanning transaction, in a transaction of the data source it was made in.
 */
export type SpanningUndoStep = (transaction: Transaction) => Promise<void>;

/**
 * One data source a spanning transaction reached, and what it wrote there.
 */
type Participant = {
    /**
     * The data source.
     */
    dataSource: DataSourceInterface,
    /**
     * Its transaction, started when the spanning transaction first reached it.
     */
    transaction: Promise<Transaction>,
    /**
     * What undoes each write made in it, in the order the writes were made.
     */
    undoSteps: SpanningUndoStep[]
};

/**
 * How often a restore runs at most when it conflicts with another transaction. It writes the rows
 * other writers may be writing meanwhile, and giving up after one conflict would leave the
 * transaction's writes in place.
 */
const RESTORE_MAX_ATTEMPTS: number = 3;

/**
 * The participants of every spanning transaction, so that a driver handed one finds them.
 */
const participantsBySpanningTransaction: WeakMap<SpanningTransaction, SpanningTransactionParticipants> = new WeakMap();

/**
 * The data sources one spanning transaction reached, each with a transaction of its own, and how to
 * undo what was written in each.
 */
export class SpanningTransactionParticipants {
    /**
     * By data source, in the order they were reached, which is the order they commit in.
     */
    private readonly participants: Map<DataSourceInterface, Participant> = new Map();

    private finished: boolean = false;

    private readonly committedWork: (() => Promise<void>)[] = [];

    private readonly finishedWork: ((committed: boolean) => Promise<void>)[] = [];

    constructor(private readonly options: StartTransactionOptions) {}

    /**
     * Ties the participants to the spanning transaction they belong to.
     * @param spanningTransaction - The spanning transaction.
     * @param participants - Its participants.
     */
    static register(spanningTransaction: SpanningTransaction, participants: SpanningTransactionParticipants): void {
        participantsBySpanningTransaction.set(spanningTransaction, participants);
    }

    /**
     * Gets the participants of a spanning transaction.
     * @param spanningTransaction - The spanning transaction.
     * @returns Its participants.
     * @throws When it was not built by its constructor.
     */
    static of(spanningTransaction: SpanningTransaction): SpanningTransactionParticipants {
        const participants: SpanningTransactionParticipants | undefined = participantsBySpanningTransaction.get(spanningTransaction);
        if (participants == undefined) {
            throw new InternalError('A spanning transaction has to be built with new SpanningTransaction().');
        }
        return participants;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isFinished(): boolean {
        return this.finished;
    }

    /**
     * Resolves the transaction of a data source, started on its first use.
     * @param dataSource - The data source.
     * @returns Its transaction.
     * @throws TransactionAlreadyFinishedError once the spanning transaction is committed or rolled back.
     */
    async resolveTransactionOn(dataSource: DataSourceInterface): Promise<Transaction> {
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }
        const joined: Participant | undefined = this.participants.get(dataSource);
        if (joined != undefined) {
            return await joined.transaction;
        }
        // the promise is kept rather than the transaction, so that two calls reaching the data source
        // at once share the one transaction instead of starting two
        const participant: Participant = {
            dataSource,
            transaction: Promise.resolve(dataSource.startTransaction(this.options)),
            undoSteps: []
        };
        this.participants.set(dataSource, participant);
        try {
            return await participant.transaction;
        }
        catch (error) {
            // nothing was started, so there is nothing to commit or roll back there
            this.participants.delete(dataSource);
            throw error;
        }
    }

    /**
     * Whether the writes made in a data source may have to be undone once it committed.
     *
     * Not those of the data source reached first, which commits last: when it fails, it is rolled
     * back with nothing of it applied, and when another one fails before, it has not committed yet. A
     * transaction reaching one data source then costs what a transaction of it costs.
     * @param dataSource - A data source the spanning transaction reached.
     * @returns True for every one but the first.
     */
    isRestorable(dataSource: DataSourceInterface): boolean {
        return this.participants.keys().next().value !== dataSource;
    }

    /**
     * Records how to undo a write that was made in the transaction of a data source.
     * @param dataSource - The data source the write was made in.
     * @param step - What undoes it.
     */
    recordUndo(dataSource: DataSourceInterface, step: SpanningUndoStep): void {
        const participant: Participant | undefined = this.participants.get(dataSource);
        if (participant == undefined) {
            throw new InternalError('A write of a spanning transaction was recorded for a data source it never reached.');
        }
        participant.undoSteps.push(step);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterCommit(work: () => Promise<void>): void {
        this.committedWork.push(work);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterFinish(work: (committed: boolean) => Promise<void>): void {
        this.finishedWork.push(work);
    }

    /**
     * Commits the transaction of every data source: the ones reached after the first in the order
     * they were reached, and the first one last.
     *
     * When one fails, the ones after it are rolled back and the ones before it are restored.
     * @throws SpanningTransactionCommitError when one of them failed to commit.
     */
    async commit(): Promise<void> {
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }
        this.finished = true;
        const [first, ...reachedAfter] = this.participants.values();
        const participants: Participant[] = first == undefined ? [] : [...reachedAfter, first];
        const committed: Participant[] = [];
        for (const [index, participant] of participants.entries()) {
            try {
                await (await participant.transaction).commit();
                committed.push(participant);
            }
            catch (error) {
                await this.rollBackAll(participants.slice(index));
                const restoreFailures: SpanningTransactionRestoreFailure[] = await this.restore(committed);
                this.committedWork.length = 0;
                await this.runFinishedWork(false);
                throw new SpanningTransactionCommitError(participant.dataSource.constructor.name, restoreFailures, { cause: error });
            }
        }
        await this.runFinishedWork(true);
        for (const work of this.committedWork.splice(0)) {
            await work();
        }
    }

    /**
     * Rolls back the transaction of every data source.
     * @throws What the first rollback that failed threw, once every one was tried.
     */
    async rollback(): Promise<void> {
        if (this.finished) {
            return;
        }
        this.finished = true;
        this.committedWork.length = 0;
        const failures: unknown[] = await this.rollBackAll([...this.participants.values()]);
        await this.runFinishedWork(false);
        if (failures.length) {
            throw failures[0];
        }
    }

    /**
     * Rolls back the transactions of some data sources, each one whatever the others do.
     * @param participants - The data sources.
     * @returns What the rollbacks that failed threw.
     */
    private async rollBackAll(participants: Participant[]): Promise<unknown[]> {
        const results: PromiseSettledResult<void>[] = await Promise.allSettled(participants.map(async participant => {
            const transaction: Transaction = await participant.transaction;
            // a commit that failed has ended its transaction already
            if (!transaction.isFinished) {
                await transaction.rollback();
            }
        }));
        return results.flatMap(result => result.status === 'rejected' ? [result.reason] : []);
    }

    /**
     * Undoes the writes in the data sources that committed, each in a transaction of its own and in
     * the reverse order of the writes.
     * @param committed - The data sources that committed.
     * @returns The data sources whose restore failed.
     */
    private async restore(committed: Participant[]): Promise<SpanningTransactionRestoreFailure[]> {
        const failures: SpanningTransactionRestoreFailure[][] = await Promise.all(committed.map(async participant => {
            try {
                // reversed, so that a row is put back before the rows that point at it, and a created
                // row that points at another is removed before that one
                await participant.dataSource.runInTransaction(async transaction => {
                    for (const step of [...participant.undoSteps].reverse()) {
                        await step(transaction);
                    }
                }, { maxAttempts: RESTORE_MAX_ATTEMPTS });
                return [];
            }
            catch (error) {
                return [{ dataSourceName: participant.dataSource.constructor.name, error }];
            }
        }));
        return failures.flat();
    }

    /**
     * Runs the work waiting for the end of the transaction.
     * @param committed - Whether every data source committed.
     */
    private async runFinishedWork(committed: boolean): Promise<void> {
        for (const work of this.finishedWork.splice(0)) {
            await work(committed);
        }
    }
}
