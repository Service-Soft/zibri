import { TransactionAlreadyFinishedError } from './transaction-already-finished.error';
import { Transaction } from './transaction.model';
import { type OperationLimit } from '../../context/operation-limit.model';
import { type PgPoolClient } from '../data-sources/postgres/postgres-client.model';

/**
 * A transaction of a postgres data source, holding the connection it runs on.
 */
export class PostgresTransaction implements Transaction {

    private finished: boolean = false;

    private readonly committedWork: (() => Promise<void>)[] = [];

    private readonly finishedWork: ((committed: boolean) => Promise<void>)[] = [];

    /**
     * Wraps a connection whose transaction was started.
     * @param client - The connection the transaction runs on.
     * @param limit - The limit it was begun under, which every statement in it already has.
     * @param run - Runs a statement on the connection, as every statement of the data source is run.
     * @param resolveCommitError - Resolves what a failed commit means, so that a conflict that ends the
     * transaction at its commit fails it the way it fails any of its statements.
     */
    constructor(
        readonly client: PgPoolClient,
        readonly limit: OperationLimit | undefined,
        private readonly run: (sql: string) => Promise<unknown>,
        private readonly resolveCommitError: (error: unknown) => unknown
    ) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isFinished(): boolean {
        return this.finished;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async commit(): Promise<void> {
        if (this.finished) {
            throw new TransactionAlreadyFinishedError();
        }
        let committed: boolean = false;
        try {
            await this.run('COMMIT');
            committed = true;
        }
        catch (error) {
            throw this.resolveCommitError(error);
        }
        finally {
            await this.finish(committed);
        }
        for (const work of this.committedWork.splice(0)) {
            await work();
        }
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterCommit(work: () => Promise<void>): void {
        this.committedWork.push(work);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    afterFinish(work: (committed: boolean) => Promise<void>): void {
        this.finishedWork.push(work);
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async rollback(): Promise<void> {
        // what a caller does on a commit that threw, or on a transaction the store already ended:
        // there is nothing left to roll back, and the connection has been handed back
        if (this.finished) {
            return;
        }
        this.committedWork.length = 0;
        let failed: Error | undefined;
        try {
            await this.run('ROLLBACK');
        }
        catch (error) {
            failed = error instanceof Error ? error : undefined;
            throw error;
        }
        finally {
            await this.finish(false, failed);
        }
    }

    /**
     * Ends a transaction that the database has already ended on its side, by closing its connection.
     *
     * Rolled back as far as everything waiting on it is concerned, which is what the database did.
     * @param error - What the connection failed with.
     */
    async abandon(error: Error): Promise<void> {
        if (this.finished) {
            return;
        }
        this.committedWork.length = 0;
        await this.finish(false, error);
    }

    /**
     * Ends the transaction and hands the connection back, whatever the outcome was.
     *
     * A commit that throws ends the transaction too - the database takes it back itself. Handing the
     * connection back only on the paths that worked loses one pooled connection for good every time a
     * commit fails, until the pool holds none.
     * @param committed - Whether the transaction was committed.
     * @param error - What the connection failed with, which ends it rather than pooling it again.
     */
    private async finish(committed: boolean, error?: Error): Promise<void> {
        this.finished = true;
        this.client.release(error);
        // spliced, so a rollback after a failed commit does not run it a second time
        for (const work of this.finishedWork.splice(0)) {
            await work(committed);
        }
    }
}