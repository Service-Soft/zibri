import { QueryRunner } from 'typeorm';

import { Transaction } from './transaction.model';

/**
 * A type orm transaction.
 */
export class TypeOrmTransaction implements Transaction {

    private finished: boolean = false;

    private readonly committedWork: (() => Promise<void>)[] = [];

    private readonly finishedWork: ((committed: boolean) => Promise<void>)[] = [];

    constructor(readonly queryRunner: QueryRunner) {}

    // eslint-disable-next-line jsdoc/require-jsdoc
    get isFinished(): boolean {
        return this.finished;
    }

    // eslint-disable-next-line jsdoc/require-jsdoc
    async commit(): Promise<void> {
        let committed: boolean = false;
        try {
            await this.queryRunner.commitTransaction();
            committed = true;
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
        this.committedWork.length = 0;
        try {
            await this.queryRunner.rollbackTransaction();
        }
        finally {
            await this.finish(false);
        }
    }

    /**
     * Ends the transaction and hands the connection back, whatever the outcome was.
     *
     * A commit that throws ends the transaction too - the database takes it back itself, so nothing
     * is left pending and nothing more can be written through this runner. Handing the connection
     * back only on the paths that worked loses one pooled connection for good every time a commit
     * fails, until the pool holds none.
     * @param committed - Whether the transaction was committed.
     */
    private async finish(committed: boolean): Promise<void> {
        this.finished = true;
        await this.queryRunner.release();
        // spliced, so a rollback after a failed commit does not run it a second time
        for (const work of this.finishedWork.splice(0)) {
            await work(committed);
        }
    }
}